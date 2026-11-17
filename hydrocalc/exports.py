"""同一套导出逻辑供浏览器下载与原生保存对话框复用。"""

from io import BytesIO, StringIO
import csv
import json
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import Workbook
from PIL import Image


def export_file(repository, identifier, kind):
    # 只导出完成的任务，文件名固定，不接收客户端指定的磁盘路径。
    record = repository.get(identifier)
    if record["status"] != "completed":
        raise ValueError("分析尚未完成，无法导出")
    directory = repository.directory(identifier)
    if kind in ("original", "mask", "annotated", "clusters", "clusters_blurred"):
        path = directory / (kind + ".png")
        if not path.is_file():
            raise ValueError("当前分析没有此图像")
        return path.read_bytes(), f"hydrocalc-{kind}.png", "image/png"

    # Excel 使用写入模式逐行输出，避免创建完整的 Python 单元格对象矩阵。
    if kind == "matrix":
        workbook = Workbook(write_only=True)
        sheet = workbook.create_sheet("像素矩阵_黑0白255")
        with Image.open(directory / "mask.png") as image:
            width, height = image.size
            pixels = image.load()
            for row in range(height):
                values = [pixels[column, row] for column in range(width)]
                sheet.append(values)
        stream = BytesIO()
        workbook.save(stream)
        return stream.getvalue(), "hydrocalc-matrix.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    # CSV 深度曲线和 ZIP 分析包包含参数快照，便于之后复核物理尺度与算法版本。
    profile_stream = StringIO(newline="")
    writer = csv.writer(profile_stream)
    writer.writerow(["depth_cm", "stained_ratio_percent"])
    for row in record["profile"]:
        writer.writerow([row["depth_cm"], row["ratio"]])
    profile_bytes = profile_stream.getvalue().encode("utf-8-sig")
    if kind == "profile":
        return profile_bytes, "hydrocalc-profile.csv", "text/csv; charset=utf-8"
    if kind != "bundle":
        raise ValueError("不支持的导出类型")

    stream = BytesIO()
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        metadata = json.dumps(record, ensure_ascii=False, indent=2)
        archive.writestr("result.json", metadata)
        archive.writestr("profile.csv", profile_bytes)
        for path in directory.glob("*.png"):
            include = record["settings"]["export_include_original"] or path.name != "original.png"
            if include:
                archive.write(path, path.name)
    return stream.getvalue(), "hydrocalc-analysis.zip", "application/zip"
