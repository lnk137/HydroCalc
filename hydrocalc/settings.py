"""参数验证与用户设置，计算过程始终使用不可变快照。"""

from dataclasses import asdict, dataclass, fields
import math


@dataclass(frozen=True)
class Settings:
    theme: str = "system"
    reduce_motion: bool = False
    method: str = "hsv"
    lower_hsv: tuple = (35, 35, 35)
    upper_hsv: tuple = (179, 255, 255)
    resolution_width: int = 500
    resolution_height: int = 500
    soil_width_cm: float = 50.0
    soil_height_cm: float = 50.0
    start_depth_cm: float = 0.0
    matrix_threshold: float = 0.8
    depth_threshold: float = 0.005
    blur_kernel: int = 3
    clusters: int = 4
    enable_clustering: bool = True
    model_id: str = ""
    model_threshold: float = 0.5
    model_logits: bool = False
    model_stain_class: int = 1
    export_include_original: bool = True

    def to_dict(self):
        # 转换为 JSON 能直接传输的值，不向界面暴露 dataclass 对象。
        data = asdict(self)
        data["lower_hsv"] = list(self.lower_hsv)
        data["upper_hsv"] = list(self.upper_hsv)
        return data

    @classmethod
    def parse(cls, data):
        # 拒绝未知字段，避免拼写错误被静默忽略。
        if not isinstance(data, dict):
            raise ValueError("设置必须为 JSON 对象")
        names = {item.name for item in fields(cls)}
        unknown = set(data) - names
        if unknown:
            raise ValueError("未知设置字段：" + ", ".join(sorted(unknown)))
        values = cls().to_dict()
        values.update(data)

        # 分别验证枚举、开关和模型标识，禁止隐式字符串转布尔。
        if values["theme"] not in ("system", "light", "dark"):
            raise ValueError("无效的主题")
        if values["method"] not in ("hsv", "binary", "model"):
            raise ValueError("无效的分割方式")
        for key in ("reduce_motion", "enable_clustering", "model_logits", "export_include_original"):
            if not isinstance(values[key], bool):
                raise ValueError(f"{key} 必须为布尔值")
        model_id = values["model_id"]
        if not isinstance(model_id, str):
            raise ValueError("模型标识必须为字符串")
        if model_id and (len(model_id) != 32 or any(c not in "0123456789abcdef" for c in model_id)):
            raise ValueError("无效的模型标识")

        # 使用 OpenCV 的实际 HSV 范围，且每个下限必须小于等于上限。
        for key in ("lower_hsv", "upper_hsv"):
            hsv = values[key]
            if not isinstance(hsv, (tuple, list)) or len(hsv) != 3:
                raise ValueError("HSV 必须包含三个整数")
            for number, maximum in zip(hsv, (179, 255, 255)):
                valid = type(number) is int and 0 <= number <= maximum
                if not valid:
                    raise ValueError("HSV 范围：H 0–179，S/V 0–255")
            values[key] = tuple(hsv)
        for lower, upper in zip(values["lower_hsv"], values["upper_hsv"]):
            if lower > upper:
                raise ValueError("HSV 下限不能大于上限")

        # 对图像尺寸、尺度、阈值做服务端校验，拒绝 NaN、无穷和布尔数值。
        ranges = {
            "resolution_width": (64, 2000),
            "resolution_height": (64, 2000),
            "soil_width_cm": (0.01, 10000),
            "soil_height_cm": (0.01, 10000),
            "start_depth_cm": (0, 10000),
            "matrix_threshold": (0.01, 1),
            "depth_threshold": (0.0001, 1),
            "clusters": (2, 8),
            "model_threshold": (0.01, 0.99),
        }
        integer_fields = ("resolution_width", "resolution_height", "clusters")
        for key, bounds in ranges.items():
            number = values[key]
            if type(number) not in (int, float):
                raise ValueError(f"{key} 必须为数字")
            if not math.isfinite(number):
                raise ValueError(f"{key} 必须为有限数字")
            if not bounds[0] <= number <= bounds[1]:
                raise ValueError(f"{key} 超出范围 {bounds[0]}–{bounds[1]}")
            if key in integer_fields and int(number) != number:
                raise ValueError(f"{key} 必须为整数")
            if key in integer_fields:
                values[key] = int(number)
        if values["start_depth_cm"] >= values["soil_height_cm"]:
            raise ValueError("起始深度必须小于剖面高度")
        if values["depth_threshold"] > values["matrix_threshold"]:
            raise ValueError("最大深度阈值不能大于基质流阈值")
        if type(values["blur_kernel"]) is not int or values["blur_kernel"] not in (0, 3, 5, 7):
            raise ValueError("模糊核只能为 0、3、5、7")
        if type(values["model_stain_class"]) is not int or values["model_stain_class"] not in (0, 1):
            raise ValueError("染色类别只能为 0 或 1")
        return cls(**values)
