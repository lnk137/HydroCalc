"""跨平台用户目录、原子 JSON 写入和分析结果仓库。"""

from copy import deepcopy
import json
from pathlib import Path
import threading
from uuid import uuid4

from platformdirs import user_data_path

from hydrocalc.settings import Settings


def default_data_dir() -> Path:
    # platformdirs 分别选择 macOS Application Support 和 Windows LocalAppData。
    return user_data_path("HydroCalc", appauthor=False)


def write_json(path: Path, data):
    # 同目录临时文件加 replace，避免进程中断后留下半份 JSON。
    temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    serialized = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False)
    try:
        temporary.write_text(serialized, encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


class Repository:
    def __init__(self, root: Path):
        # 分离设置、模型和分析目录，资源目录保持只读，路径可包含中文和空格。
        self.root = root.resolve()
        self.analyses = self.root / "analyses"
        self.models = self.root / "models"
        self.analyses.mkdir(parents=True, exist_ok=True)
        self.models.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()

    def settings(self) -> Settings:
        # 每次返回独立的不可变配置，损坏的文件保留给用户检查。
        path = self.root / "settings.json"
        if not path.exists():
            return Settings()
        data = json.loads(path.read_text(encoding="utf-8"))
        return Settings.parse(data)

    def save_settings(self, settings: Settings):
        # 设置写入与任务状态写入共用进程内锁，防止并发覆盖临时文件。
        with self.lock:
            write_json(self.root / "settings.json", settings.to_dict())

    def directory(self, identifier: str) -> Path:
        # 只允许随机标识，前端不能传任意磁盘路径。
        valid = len(identifier) == 32 and all(c in "0123456789abcdef" for c in identifier)
        if not valid:
            raise ValueError("无效的分析标识")
        return self.analyses / identifier

    def get(self, identifier: str) -> dict:
        # 读取已发布清单，图像和数据准备好后才会标记为完成。
        path = self.directory(identifier) / "result.json"
        with self.lock:
            if not path.is_file():
                raise FileNotFoundError("分析记录不存在")
            content = path.read_text(encoding="utf-8")
            return json.loads(content)

    def put(self, record: dict):
        # 存储副本，调用方后续修改不会影响正在序列化的数据。
        directory = self.directory(record["id"])
        directory.mkdir(parents=True, exist_ok=True)
        with self.lock:
            write_json(directory / "result.json", deepcopy(record))

    def history(self) -> list:
        # 列表不携带逐行曲线，减少大批历史记录的传输量。
        records = []
        with self.lock:
            for path in self.analyses.glob("*/result.json"):
                try:
                    record = json.loads(path.read_text(encoding="utf-8"))
                    summary = {
                        key: record.get(key)
                        for key in ("id", "name", "created_at", "status", "stage", "metrics", "error")
                    }
                    records.append(summary)
                except (OSError, ValueError):
                    continue
        records.sort(key=lambda record: record["created_at"], reverse=True)
        return records

    def recover(self):
        # 重启后明确标记未完成任务，不让界面永久等待已不存在的工作线程。
        for record in self.history():
            if record["status"] in ("queued", "running"):
                complete_record = self.get(record["id"])
                complete_record.update({
                    "status": "failed",
                    "stage": "分析中断",
                    "error": "上次运行已结束，请重新选择图片分析",
                })
                self.put(complete_record)
