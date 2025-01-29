from io import BytesIO
from tkinter import filedialog, Image
from flask import Blueprint, request, jsonify, send_file
import os
import cv2
import numpy as np
import torch  # 使用 PyTorch 代替 TensorFlow
from utils.image_utils import *
import config  # 导入config模块
from PIL import Image


# 创建蓝图
model_bp = Blueprint('model', __name__)


@model_bp.route('/getModelPath', methods=['POST'])
def getModelPath():
    file_path = filedialog.askopenfilename()
    print(f"选择的文件路径: {file_path}") # 使用 global 声明 ModelPath 变量
    config.model_path = file_path
    return jsonify({"file_path": file_path})


# 预处理输入图像
def preprocess_image(pil_image, img_size=(256, 256)):
    # 将 PIL 图像转换为 NumPy 数组（RGB）
    img = np.array(pil_image)
    
    # 检查是否为 4 通道（RGBA）
    if img.shape[2] == 4:
        # 分离 RGB 和 Alpha 通道
        r, g, b, a = cv2.split(img)
        # 合并为 RGB 三通道（忽略 alpha）
        img = cv2.merge((r, g, b))
    
    
    # 对图像进行高斯模糊处理
    img = cv2.GaussianBlur(img, (1, 1), 0)
    
    # 调整图像大小
    img = cv2.resize(img, img_size)  # 调整图像大小
    img = img / 255.0  # 归一化
    img = np.transpose(img, (2, 0, 1))  # 调整为 PyTorch 的格式 (C, H, W)
    img = np.expand_dims(img, axis=0)  # 增加一个批次维度

    return torch.tensor(img, dtype=torch.float32)  # 转换为 PyTorch 张量


# 进行预测
def predict_segmentation(model, image):
    model.eval()  # 设置模型为评估模式
    with torch.no_grad():  # 禁用梯度计算
        predicted_mask = model(image).cpu().numpy()[0, 0, :, :]  # 获取预测的掩码
        predicted_mask = (predicted_mask > 0.5).astype(np.uint8)  # 阈值化，二值化掩码
    return predicted_mask


# 加载真实的分割掩码
def load_true_mask(mask, img_size=(256, 256)):
    true_mask = cv2.imdecode(np.frombuffer(mask.read(), np.uint8), cv2.IMREAD_GRAYSCALE)
    true_mask = (cv2.resize(true_mask, img_size))  # 调整大小以匹配预测的大小
    true_mask = (true_mask > 127).astype(np.uint8)  # 二值化（0或1）
    return true_mask


# API 路由：进行图像分割
@model_bp.route("/model_predict", methods=["POST"])
def segment_image():
    # 从请求体中获取图像路径
    # 获取上传的文件
    file = request.files['file']
    img = Image.open(file)
    config.original_picture = img
    # 加载模型
    model = torch.load(config.model_path, map_location=torch.device('cpu'))
    model.eval()  # 确保模型在评估模式

    # 预处理输入图像
    image = preprocess_image(img)

    # 进行分割预测
    predicted_mask = predict_segmentation(model, image)

    # 后处理：生成彩色的分割结果图像
    color_map = {
        0: [0, 0, 0],  # 背景色（黑色）
        1: [255, 255, 255]  # 前景色（白色）
    }

    h, w = predicted_mask.shape[:2]
    result_image = np.zeros((h, w, 3), dtype=np.uint8)

    for i in range(h):
        for j in range(w):
            label = predicted_mask[i, j]
            result_image[i, j] = color_map[label]  # 应用颜色映射
            
    height, width = config.resolution
    # 调整结果图像的分辨率为 500x500
    result_image = cv2.resize(result_image, (height, width))

    # 将调整后的图像转换为 PIL 格式并返回
    img_pil = Image.fromarray(result_image)
    config.grayscale_picture = img_pil
    calculate_parameters(img_pil)
    save_grayscale_image_to_excel(img_pil)
    # 绘制红线、蓝线和绿线
    display_img = img_pil.copy()
    display_img = draw_red_line(display_img, config.matrix_flow_depth * 10)
    display_img = draw_blue_line(display_img, config.start_height)
    display_img = draw_green_line(display_img, config.maximum_staining_depth * 10)

    img_io = BytesIO()
    display_img.save(img_io, 'PNG')
    img_io.seek(0)

    return send_file(img_io, mimetype='image/png')
