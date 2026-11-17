"""有界后台任务队列，每项任务拥有独立输入、参数和导出文件。"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import logging
import shutil
import threading
from uuid import uuid4

from hydrocalc.analysis import (
    annotated_image, calculate_metrics, cluster_image, mask_image, read_image, segment,
)
from hydrocalc.storage import Repository

logger = logging.getLogger(__name__)


class Jobs:
    def __init__(self, repository: Repository):
        # 单个工作线程防止多个高分辨率任务争抢 CPU，最多允许四个在途任务。
        self.repository = repository
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="hydrocalc")
        self.slots = threading.BoundedSemaphore(4)
        self.closed = False
        self.lifecycle_lock = threading.Lock()
        repository.recover()

    def submit(self, content, name, settings):
        # 在接收任务前进行背压，队列满时直接反馈而不是无限累积图片内存。
        with self.lifecycle_lock:
            if self.closed:
                raise RuntimeError("应用正在退出")
            accepted = self.slots.acquire(blocking=False)
            if not accepted:
                raise RuntimeError("最多同时排队四张图片，请等待当前分析完成")
            identifier = uuid4().hex
            record = {
                "id": identifier,
                "name": name,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "queued",
                "stage": "等待分析",
                "settings": settings.to_dict(),
            }
            try:
                self.repository.put(record)
                self.executor.submit(self._run, record, content, settings)
            except Exception:
                self.slots.release()
                raise
            return record

    def _stage(self, record, stage):
        # 各阶段都落盘，界面显示实际步骤而不是编造百分比。
        record["stage"] = stage
        self.repository.put(record)

    def _run(self, record, content, settings):
        # 每项任务只修改自己的目录与清单，错误也绑定到同一项任务。
        try:
            record["status"] = "running"
            self._stage(record, "读取图片")
            image = read_image(content)
            directory = self.repository.directory(record["id"])
            image.save(directory / "original.png")

            # 分割图仅在本任务内传递，模型路径由应用目录中的标识解析。
            self._stage(record, "提取染色区域")
            model_path = None
            if settings.model_id:
                model_path = self.repository.models / (settings.model_id + ".pt")
            mask = segment(image, settings, model_path)
            self._stage(record, "计算优先流指标")
            metrics, profile = calculate_metrics(mask, settings)
            binary = mask_image(mask)
            binary.save(directory / "mask.png")
            annotated = annotated_image(mask, metrics, settings)
            annotated.save(directory / "annotated.png")

            # 两张聚类图分别保存对应的类别统计，显示模式切换不会混用统计。
            colors = {}
            if settings.enable_clustering:
                self._stage(record, "生成颜色聚类")
                for blurred, key in ((False, "clusters"), (True, "clusters_blurred")):
                    clustered, statistics = cluster_image(image, mask, settings, blurred)
                    clustered.save(directory / (key + ".png"))
                    colors[key] = statistics
            record.update({
                "status": "completed",
                "stage": "分析完成",
                "metrics": metrics,
                "profile": profile,
                "colors": colors,
                "source_size": list(image.size),
            })
            self.repository.put(record)
        except Exception as error:
            logger.exception("Analysis failed: %s", record["id"])
            message = str(error) if isinstance(error, ValueError) else "分析失败，请查看应用日志或重试"
            record.update({
                "status": "failed",
                "stage": "分析失败",
                "error": message,
            })
            self.repository.put(record)
        finally:
            self.slots.release()

    def delete(self, identifier):
        # 禁止删除仍在运行的任务，防止工作线程写入已被移除的目录。
        with self.repository.lock:
            record = self.repository.get(identifier)
            if record["status"] in ("queued", "running"):
                raise RuntimeError("请等待分析完成后再删除")
            directory = self.repository.directory(identifier)
            shutil.rmtree(directory)

    def close(self):
        # 退出时等待已接收的有限队列完成，避免后台线程继续访问关闭的服务。
        with self.lifecycle_lock:
            if self.closed:
                return
            self.closed = True
        self.executor.shutdown(wait=True)
