"""可选 TorchScript 推理适配器，基础版本不导入 PyTorch。"""

import cv2
import numpy as np


def predict(image, settings, model_path):
    # 只接受应用已导入的 TorchScript 文件，不执行旧版任意 pickle 模型。
    if model_path is None or not model_path.is_file():
        raise ValueError("请先在设置中导入 TorchScript 模型")
    try:
        import torch
    except ImportError as error:
        raise ValueError("此版本未包含模型组件，请使用 AI 构建或安装 model 可选依赖") from error

    # 固定模型输入为 RGB、256×256、NCHW，和原项目的输入约定一致。
    resized = image.resize((256, 256))
    pixels = np.asarray(resized, dtype=np.float32) / 255
    channels = np.transpose(pixels, (2, 0, 1)).copy()
    tensor = torch.from_numpy(channels).unsqueeze(0)
    try:
        model = torch.jit.load(str(model_path), map_location="cpu")
        model.eval()
        with torch.inference_mode():
            prediction = model(tensor)
    except Exception as error:
        raise ValueError("模型加载或推理失败，请检查 TorchScript 格式和输入约定") from error

    # 校验单通道二分类输出，按设置处理 logits 和染色类别。
    if not isinstance(prediction, torch.Tensor):
        raise ValueError("模型输出必须是 [1, 1, H, W] 张量")
    if prediction.ndim != 4 or tuple(prediction.shape[:2]) != (1, 1):
        raise ValueError("模型输出必须是 [1, 1, H, W] 张量")
    if settings.model_logits:
        prediction = torch.sigmoid(prediction)
    scores = prediction[0, 0].cpu().numpy()
    if not np.isfinite(scores).all():
        raise ValueError("模型输出包含无效数字")
    if scores.min() < 0 or scores.max() > 1:
        raise ValueError("模型输出不是概率，请在设置中启用 logits 转换")
    selected = scores > settings.model_threshold
    if settings.model_stain_class == 0:
        selected = ~selected
    size = (settings.resolution_width, settings.resolution_height)
    output = cv2.resize(selected.astype(np.uint8), size, interpolation=cv2.INTER_NEAREST)
    return output.astype(bool)
