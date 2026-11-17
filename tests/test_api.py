"""端到端检查真实任务、隔离、持久化和导出协议。"""

from io import BytesIO
import json
import time
from zipfile import ZipFile

from PIL import Image
import pytest

from hydrocalc.api import create_app
from hydrocalc.settings import Settings
from hydrocalc.storage import Repository

HEADERS = {
    "X-HydroCalc": "1",
}


@pytest.fixture
def application(tmp_path):
    # 每个测试使用自己的用户目录和工作线程，结束时完整关闭队列。
    app = create_app(tmp_path)
    app.config["TESTING"] = True
    yield app
    app.extensions["jobs"].close()


def upload(client, color, width=50):
    # 通过真实 multipart 接口提交图片和参数快照。
    stream = BytesIO()
    Image.new("RGB", (100, 100), color).save(stream, "PNG")
    stream.seek(0)
    settings = Settings().to_dict()
    settings.update({
        "method": "binary",
        "resolution_width": 100,
        "resolution_height": 100,
        "soil_width_cm": width,
        "enable_clustering": False,
    })
    response = client.post("/api/analyses", headers=HEADERS, data={
        "file": (stream, "中文 土壤.png"),
        "settings": json.dumps(settings),
    })
    assert response.status_code == 202
    return response.json["id"]


def wait_result(client, identifier):
    # 以超时约束等待真实后台任务，失败时保留任务错误方便定位。
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        response = client.get(f"/api/analyses/{identifier}")
        record = response.json
        if record["status"] in ("completed", "failed"):
            assert record["status"] == "completed", record
            return record
        time.sleep(0.01)
    pytest.fail("后台任务超时")


def test_jobs_are_isolated_and_history_survives_restart(application, tmp_path):
    # 两次连续上传使用不同宽度与染色图，不允许串用结果或设置。
    client = application.test_client()
    first = upload(client, "black", width=40)
    second = upload(client, "white", width=80)
    first_record = wait_result(client, first)
    second_record = wait_result(client, second)
    assert first_record["metrics"]["stained_area_cm2"] == 2000
    assert second_record["metrics"]["stained_area_cm2"] == 0
    assert first_record["settings"]["soil_width_cm"] == 40
    assert len(client.get("/api/analyses").json) == 2
    repository = Repository(tmp_path)
    assert repository.get(first)["name"] == "中文 土壤.png"


def test_exports_use_unannotated_mask_and_snapshot(application):
    # 矩阵必须保持纯黑白，分析包应携带完整参数与深度曲线。
    client = application.test_client()
    identifier = upload(client, "black")
    wait_result(client, identifier)
    response = client.get(f"/api/analyses/{identifier}/export/bundle")
    assert response.status_code == 200
    with ZipFile(BytesIO(response.data)) as archive:
        assert "profile.csv" in archive.namelist()
        record = json.loads(archive.read("result.json"))
        assert record["settings"]["soil_width_cm"] == 50
        image = Image.open(BytesIO(archive.read("mask.png")))
        assert image.getextrema() == (0, 0)
    matrix = client.get(f"/api/analyses/{identifier}/export/matrix")
    assert matrix.status_code == 200
    assert matrix.data[:2] == b"PK"
    invalid = client.get(f"/api/analyses/{identifier}/images/secret")
    assert invalid.status_code == 400
    deleted = client.delete(f"/api/analyses/{identifier}", headers=HEADERS)
    assert deleted.status_code == 204
    assert client.get(f"/api/analyses/{identifier}").status_code == 404


def test_settings_round_trip_and_cross_origin_protection(application):
    # 设置验证失败不能覆盖已有文件，缺少自定义头的写请求必须拒绝。
    client = application.test_client()
    settings = Settings().to_dict()
    settings["theme"] = "dark"
    assert client.put("/api/settings", json=settings).status_code == 403
    saved = client.put("/api/settings", json=settings, headers=HEADERS)
    assert saved.status_code == 200
    invalid = client.put("/api/settings", json={"soil_width_cm": 0}, headers=HEADERS)
    assert invalid.status_code == 400
    bootstrap = client.get("/api/bootstrap").json
    assert bootstrap["settings"]["theme"] == "dark"
    assert client.get("/api/bootstrap", headers={"Host": "evil.example"}).status_code == 403


def test_corrupt_upload_becomes_failed_job_without_leaking_old_metrics(application):
    # 图片解码失败是明确的终态，不能继续展示另一任务的指标。
    client = application.test_client()
    response = client.post("/api/analyses", headers=HEADERS, data={
        "file": (BytesIO(b"invalid"), "bad.png"),
    })
    identifier = response.json["id"]
    application.extensions["jobs"].close()
    record = client.get(f"/api/analyses/{identifier}").json
    assert record["status"] == "failed"
    assert "无法读取" in record["error"]
    assert "metrics" not in record


def test_interrupted_jobs_are_recovered(tmp_path):
    # 模拟上次进程中断，重启后应显示可恢复的失败状态。
    repository = Repository(tmp_path)
    identifier = "a" * 32
    repository.put({
        "id": identifier,
        "name": "interrupted.png",
        "created_at": "2026-01-01T00:00:00Z",
        "status": "running",
        "stage": "提取染色区域",
    })
    application = create_app(tmp_path)
    try:
        assert repository.get(identifier)["status"] == "failed"
    finally:
        application.extensions["jobs"].close()
