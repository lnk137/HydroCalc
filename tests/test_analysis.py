"""检查物理尺度、不变性、空白边界和输入通道。"""

from dataclasses import replace
from io import BytesIO

import numpy as np
from PIL import Image
import pytest

from hydrocalc.analysis import calculate_metrics, cluster_image, read_image, segment
from hydrocalc.settings import Settings


@pytest.mark.parametrize("size", [100, 500, 1000])
def test_physical_metrics_do_not_depend_on_resolution(size):
    # 同一 50×40 cm 剖面的上半部染色，改变像素数量不能改变物理指标。
    settings = replace(Settings(), soil_height_cm=40)
    mask = np.zeros((size, size), dtype=bool)
    mask[:size // 2] = True
    metrics, profile = calculate_metrics(mask, settings)
    assert metrics["stained_area_cm2"] == 1000
    assert metrics["matrix_depth_cm"] == 20
    assert metrics["maximum_depth_cm"] == 20
    assert metrics["priority_percentage"] == 0
    assert metrics["priority_area_ratio"] == 0
    assert metrics["length_index"] == 100
    assert len(profile) == size


@pytest.mark.parametrize("stained", [False, True])
def test_empty_and_full_profiles_have_defined_results(stained):
    # 无染色不除零，全部染色时基质流贯穿完整剖面。
    mask = np.full((100, 100), stained, dtype=bool)
    metrics, _ = calculate_metrics(mask, Settings())
    assert metrics["stained_area_cm2"] == (2500 if stained else 0)
    assert metrics["matrix_depth_cm"] == (50 if stained else 0)
    assert metrics["maximum_depth_cm"] == (50 if stained else 0)
    assert metrics["priority_percentage"] == 0
    assert metrics["length_index"] == 0


def test_priority_region_counts_actual_stained_pixels():
    # 上部 90% 染色、下部 20% 染色，结果由真实像素计数得到而不是矩形差。
    mask = np.zeros((100, 100), dtype=bool)
    mask[:50, :90] = True
    mask[50:, :20] = True
    metrics, _ = calculate_metrics(mask, Settings())
    assert metrics["stained_area_cm2"] == 1375
    assert metrics["priority_area_ratio"] == 10
    assert metrics["priority_percentage"] == pytest.approx(18.1818)


def test_binary_and_hsv_use_consistent_stain_polarity():
    # 黑色二值图和 HSV 范围内的绿色都表示染色，白色表示未染色。
    black = Image.new("RGB", (100, 100), "black")
    binary_settings = replace(Settings(), method="binary")
    assert segment(black, binary_settings).all()
    green = Image.new("RGB", (100, 100), (40, 130, 90))
    assert segment(green, Settings()).all()
    white = Image.new("RGB", (100, 100), "white")
    assert not segment(white, Settings()).any()


def test_rgba_composited_on_white_and_non_image_rejected():
    # 透明区域作为未染色背景，避免透明 PNG 解码成黑色后扩大染色区域。
    source = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    stream = BytesIO()
    source.save(stream, "PNG")
    image = read_image(stream.getvalue())
    assert image.mode == "RGB"
    assert image.getpixel((0, 0)) == (255, 255, 255)
    with pytest.raises(ValueError, match="无法读取"):
        read_image(b"not an image")


def test_monochrome_clustering_handles_fewer_distinct_colors():
    # 只有一种颜色的图不强制生成四个空类别，面积合计仍等于标定面积。
    image = Image.new("RGB", (100, 100), "white")
    settings = replace(Settings(), resolution_width=100, resolution_height=100)
    mask = np.zeros((100, 100), dtype=bool)
    clustered, statistics = cluster_image(image, mask, settings, False)
    assert clustered.size == (100, 100)
    assert len(statistics) == 1
    assert statistics[0]["area_cm2"] == 2500
    assert statistics[0]["ratio"] == 100


@pytest.mark.parametrize("overrides", [
    {"resolution_width": 0},
    {"soil_width_cm": float("nan")},
    {"soil_height_cm": True},
    {"lower_hsv": [180, 0, 0]},
    {"lower_hsv": [100, 100, 100], "upper_hsv": [50, 255, 255]},
    {"clusters": 2.5},
    {"reduce_motion": "false"},
    {"model_id": "../../secret"},
    {"start_depth_cm": 50},
    {"unknown": 1},
])
def test_invalid_settings_are_rejected(overrides):
    # 界面约束不能代替服务端验证，非有限数字、未知字段与路径均应失败。
    with pytest.raises(ValueError):
        Settings.parse(overrides)
