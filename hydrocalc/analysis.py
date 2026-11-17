"""纯计算模块：不依赖 Flask、桌面窗口或全局配置。"""

from io import BytesIO
import math
import warnings

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError
from sklearn.cluster import KMeans
from threadpoolctl import threadpool_limits

from hydrocalc.settings import Settings

MAX_PIXELS = 30_000_000


def read_image(content: bytes) -> Image.Image:
    # 限制解码尺寸并应用拍摄方向，RGBA、灰度和调色板统一转换为 RGB。
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as source:
                if source.width * source.height > MAX_PIXELS:
                    raise ValueError("图片不能超过 3000 万像素")
                oriented = ImageOps.exif_transpose(source)
                rgba = oriented.convert("RGBA")
                background = Image.new("RGBA", rgba.size, "white")
                background.alpha_composite(rgba)
                return background.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        raise ValueError("无法读取图片，请选择有效的 PNG 或 JPEG") from error


def segment(image: Image.Image, settings: Settings, model_path=None) -> np.ndarray:
    # 黑白输入保持硬边界，彩色输入再使用可配置的平滑与 HSV 阈值。
    size = (settings.resolution_width, settings.resolution_height)
    if settings.method == "binary":
        grayscale = image.convert("L")
        resized = grayscale.resize(size, Image.Resampling.NEAREST)
        return np.asarray(resized) <= 127
    if settings.method == "model":
        from hydrocalc.model import predict
        return predict(image, settings, model_path)

    # 统一使用 RGB 输入，范围内像素就是染色区域，内部表示始终为布尔值。
    resized = image.resize(size, Image.Resampling.LANCZOS)
    pixels = np.asarray(resized)
    if settings.blur_kernel:
        kernel = (settings.blur_kernel, settings.blur_kernel)
        pixels = cv2.GaussianBlur(pixels, kernel, 0)
    hsv = cv2.cvtColor(pixels, cv2.COLOR_RGB2HSV)
    lower = np.array(settings.lower_hsv, dtype=np.uint8)
    upper = np.array(settings.upper_hsv, dtype=np.uint8)
    selected = cv2.inRange(hsv, lower, upper)
    return selected > 0


def calculate_metrics(mask: np.ndarray, settings: Settings) -> tuple:
    # 用用户标定的物理宽高换算每个像素的面积和深度，分辨率不改变物理尺度。
    height, width = mask.shape
    row_ratios = mask.mean(axis=1)
    pixel_area = settings.soil_width_cm * settings.soil_height_cm / (width * height)
    stained_pixels = int(mask.sum())
    area = stained_pixels * pixel_area
    pixel_height = settings.soil_height_cm / height
    start_row = math.floor(settings.start_depth_cm / pixel_height)

    # 从指定深度寻找首个低于基质阈值的行；全染色延伸到剖面底部，全空白为零。
    candidates = np.flatnonzero(row_ratios[start_row:] <= settings.matrix_threshold)
    if candidates.size:
        matrix_row = start_row + int(candidates[0])
    else:
        matrix_row = height
    if stained_pixels == 0:
        matrix_row = start_row
    matrix_depth = matrix_row * pixel_height

    # 优先流只统计基质流边界以下的实际染色像素，避免减去矩形面积后出现负值。
    priority_pixels = int(mask[matrix_row:, :].sum())
    priority_area = priority_pixels * pixel_area
    percentage = priority_pixels / stained_pixels * 100 if stained_pixels else 0.0
    total_area = settings.soil_width_cm * settings.soil_height_cm

    # 最大深度使用达到阈值的最深一行下边界；长度指数保持逐行比例变化的定义。
    stained_rows = np.flatnonzero(row_ratios >= settings.depth_threshold)
    maximum_depth = 0.0
    if stained_rows.size:
        maximum_depth = (int(stained_rows[-1]) + 1) * pixel_height
    length_index = float(np.abs(np.diff(row_ratios)).sum()) * 100
    if stained_pixels == 0:
        matrix_depth = 0.0
    metrics = {
        "stained_area_cm2": round(area, 4),
        "stained_ratio": round(stained_pixels / mask.size * 100, 4),
        "matrix_depth_cm": round(matrix_depth, 4),
        "priority_percentage": round(percentage, 4),
        "priority_area_ratio": round(priority_area / total_area * 100, 4),
        "maximum_depth_cm": round(maximum_depth, 4),
        "length_index": round(length_index, 4),
    }
    profile = []
    for index, ratio in enumerate(row_ratios):
        profile.append({
            "depth_cm": round((index + 0.5) * pixel_height, 4),
            "ratio": round(float(ratio) * 100, 4),
        })
    return metrics, profile


def mask_image(mask: np.ndarray) -> Image.Image:
    # 对外维持黑色代表染色、白色代表背景的图像约定。
    pixels = np.where(mask, 0, 255).astype(np.uint8)
    return Image.fromarray(pixels)


def annotated_image(mask: np.ndarray, metrics: dict, settings: Settings) -> Image.Image:
    # 绘制副本，不污染用于计算和导出矩阵的二值图。
    image = mask_image(mask).convert("RGB")
    draw = ImageDraw.Draw(image)
    width, height = image.size
    lines = [
        (metrics["matrix_depth_cm"], "#b87568"),
        (settings.start_depth_cm, "#6b8eaa"),
        (metrics["maximum_depth_cm"], "#789284"),
    ]
    thickness = max(1, round(height / 250))
    for depth, color in lines:
        row = min(height - 1, round(depth / settings.soil_height_cm * height))
        draw.line([(0, row), (width - 1, row)], fill=color, width=thickness)
    return image


def cluster_image(image: Image.Image, mask: np.ndarray, settings: Settings, blurred: bool) -> tuple:
    # 保留染色区原色，背景设为白色；两种模糊模式分别生成自己的统计。
    size = (settings.resolution_width, settings.resolution_height)
    resized = image.resize(size, Image.Resampling.LANCZOS)
    pixels = np.array(resized)
    pixels[~mask] = 255
    if blurred:
        pixels = cv2.GaussianBlur(pixels, (7, 7), 0)
    hsv = cv2.cvtColor(pixels, cv2.COLOR_RGB2HSV)
    flattened = hsv.reshape(-1, 3)

    # 固定抽样上限与随机种子，避免对数百万像素重复进行十次完整拟合。
    rng = np.random.default_rng(42)
    sample_count = min(len(flattened), 20000)
    indices = rng.choice(len(flattened), sample_count, replace=False)
    samples = flattened[indices]
    unique_count = len(np.unique(samples, axis=0))
    count = min(settings.clusters, unique_count)
    estimator = KMeans(n_clusters=count, n_init=3, random_state=42)
    with threadpool_limits(limits=1):
        estimator.fit(samples)
        labels = estimator.predict(flattened)
    centers = estimator.cluster_centers_.astype(np.uint8)
    colors = cv2.cvtColor(centers.reshape(1, -1, 3), cv2.COLOR_HSV2RGB)[0]
    output = colors[labels].reshape(pixels.shape)

    # 每个类别的物理面积与主分析使用同一标定，不把白色背景叫作染色面积。
    statistics = []
    total_area = settings.soil_width_cm * settings.soil_height_cm
    for index, color in enumerate(colors):
        fraction = float(np.count_nonzero(labels == index)) / len(labels)
        hex_color = "#{:02x}{:02x}{:02x}".format(*color)
        statistics.append({
            "color": hex_color,
            "area_cm2": round(fraction * total_area, 4),
            "ratio": round(fraction * 100, 4),
        })
    statistics.sort(key=lambda item: item["ratio"], reverse=True)
    return Image.fromarray(output), statistics
