"""应用工厂：前端与 API 同源，HTTP 层不操作系统对话框。"""

from io import BytesIO
import importlib.util
import json
from pathlib import Path
import platform
from uuid import uuid4

from flask import Flask, jsonify, request, send_file, send_from_directory
from werkzeug.exceptions import HTTPException

from hydrocalc import __version__
from hydrocalc.exports import export_file
from hydrocalc.jobs import Jobs
from hydrocalc.settings import Settings
from hydrocalc.storage import Repository, default_data_dir


def create_app(data_dir=None, web_dir=None):
    # 配置、队列、结果仓库属于应用实例，测试与多个实例之间没有共享全局状态。
    repository = Repository(Path(data_dir) if data_dir else default_data_dir())
    jobs = Jobs(repository)
    frontend = Path(web_dir) if web_dir else Path(__file__).parent / "web"
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 512 * 1024 * 1024
    app.extensions["repository"] = repository
    app.extensions["jobs"] = jobs

    @app.before_request
    def local_requests_only():
        # 固定回环主机并要求写请求携带自定义头，不开放跨域 CORS。
        hostname = request.host.partition(":")[0]
        if hostname not in ("127.0.0.1", "localhost"):
            return jsonify(error="仅允许本机访问"), 403
        if request.path.startswith("/api/") and request.method in ("POST", "PUT", "DELETE"):
            if request.headers.get("X-HydroCalc") != "1":
                return jsonify(error="无效的应用请求"), 403

    @app.after_request
    def response_headers(response):
        # API 不使用浏览器缓存，图片按不可变任务标识区分，不会复用旧结果。
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.errorhandler(Exception)
    def handle_error(error):
        # 所有错误遵循统一 JSON 格式，前端可以直接显示可操作的错误信息。
        if isinstance(error, HTTPException):
            message = "文件过大，图片上限 20 MB、模型上限 512 MB" if error.code == 413 else error.description
            return jsonify(error=message), error.code
        if isinstance(error, FileNotFoundError):
            return jsonify(error=str(error)), 404
        if isinstance(error, (ValueError, json.JSONDecodeError)):
            return jsonify(error=str(error)), 400
        if isinstance(error, RuntimeError):
            return jsonify(error=str(error)), 409
        app.logger.exception("Unhandled application error")
        return jsonify(error="操作失败，请查看应用日志"), 500

    @app.get("/api/bootstrap")
    def bootstrap():
        # 暴露实际运行能力与用户目录，设置页据此说明 AI 组件是否可用。
        model_available = importlib.util.find_spec("torch") is not None
        return jsonify({
            "version": __version__,
            "platform": platform.system(),
            "data_dir": str(repository.root),
            "model_available": model_available,
            "settings": repository.settings().to_dict(),
            "defaults": Settings().to_dict(),
        })

    @app.put("/api/settings")
    def save_settings():
        # 先验证全部字段，通过后一次性保存，失败时不留下半份设置。
        settings = Settings.parse(request.get_json())
        repository.save_settings(settings)
        return jsonify(settings.to_dict())

    @app.get("/api/analyses")
    def history():
        return jsonify(repository.history())

    @app.post("/api/analyses")
    def analyze():
        # 每次提交都携带自己的参数快照，不依赖另一项更新设置请求先完成。
        file = request.files.get("file")
        if file is None:
            raise ValueError("请选择一张图片")
        content = file.read(20 * 1024 * 1024 + 1)
        if not content:
            raise ValueError("图片不能为空")
        if len(content) > 20 * 1024 * 1024:
            raise ValueError("图片不能超过 20 MB")
        raw_settings = request.form.get("settings")
        settings = Settings.parse(json.loads(raw_settings)) if raw_settings else repository.settings()
        name = (file.filename or "未命名图片").replace("\\", "/").rsplit("/", 1)[-1][:150]
        record = jobs.submit(content, name, settings)
        return jsonify(record), 202

    @app.get("/api/analyses/<identifier>")
    def analysis(identifier):
        return jsonify(repository.get(identifier))

    @app.delete("/api/analyses/<identifier>")
    def delete_analysis(identifier):
        jobs.delete(identifier)
        return "", 204

    @app.get("/api/analyses/<identifier>/export/<kind>")
    def download(identifier, kind):
        content, filename, mimetype = export_file(repository, identifier, kind)
        return send_file(BytesIO(content), mimetype=mimetype, download_name=filename, as_attachment=True)

    @app.get("/api/analyses/<identifier>/images/<kind>")
    def preview(identifier, kind):
        # 图像预览仅允许已知种类，拒绝路径拼接和未发布的分析。
        record = repository.get(identifier)
        if record["status"] != "completed":
            raise ValueError("分析尚未完成")
        allowed = ("original", "mask", "annotated", "clusters", "clusters_blurred")
        if kind not in allowed:
            raise ValueError("无效的图像类型")
        directory = repository.directory(identifier)
        return send_from_directory(directory, kind + ".png")

    @app.post("/api/models")
    def import_model():
        # 模型导入不立即执行，使用 UUID 名称保存，原始文件名仅供显示。
        file = request.files.get("file")
        if file is None:
            raise ValueError("请选择 TorchScript 模型")
        name = (file.filename or "model.pt").replace("\\", "/").rsplit("/", 1)[-1]
        if Path(name).suffix.lower() not in (".pt", ".pth", ".torchscript"):
            raise ValueError("请选择 .pt、.pth 或 .torchscript 格式的 TorchScript 文件")
        identifier = uuid4().hex
        target = repository.models / (identifier + ".pt")
        file.save(target)
        if target.stat().st_size == 0:
            target.unlink()
            raise ValueError("模型文件不能为空")
        return jsonify({
            "id": identifier,
            "name": name,
        }), 201

    @app.get("/")
    def index():
        # 从包内绝对资源路径读取前端，不依赖用户从哪个工作目录启动。
        if not (frontend / "index.html").is_file():
            return "前端尚未构建，请运行 python scripts/build.py --frontend-only", 503
        return send_from_directory(frontend, "index.html")

    @app.get("/<path:path>")
    def static_file(path):
        return send_from_directory(frontend, path)

    return app
