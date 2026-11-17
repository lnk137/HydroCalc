# HydroCalc 2

土壤优先流图像分析桌面应用，支持 macOS 和 Windows。界面使用中性微灰白与莫兰迪薄荷绿，提供参考 One Dark Pro 的深色模式、中文和英语。

[English](README.en.md) · [架构](docs/ARCHITECTURE.md) · [指标定义](docs/METRICS.md) · [验证记录](docs/VALIDATION.md)

## 功能

- 自动识别彩色与近乎纯黑白输入，也可明确选择 HSV 提取或二值图分析。
- HSV 双端滑块、键盘微调和精确数值输入，参数自动保存。
- 按剖面实际宽高标定七项优先流指标，生成可悬停检查的深度曲线。
- 有／无高斯模糊的 K-means 聚类及各自独立的颜色面积统计。
- 多选图片、文件夹及文件夹拖入；批量排队、失败隔离、取消等待项和重试失败项。
- 原图、二值图、参考线图、聚类图预览与放大。
- 导出 PNG、Excel 像素矩阵、深度 CSV、指标 CSV、完整 ZIP 分析包；批量 ZIP 附汇总 CSV。
- SQLite 保存历史和每项任务的参数快照，配置文件保存设置，重启后自动恢复。

本阶段不包含 AI、模型推理、Python 或相关运行依赖。旧 README 提及但旧仓库没有代码的三维重建、模型训练、回归分析不作为已存在功能保留。

## 技术与目录

| 部分 | 实现 |
| --- | --- |
| 界面 | Vue 3 + TypeScript + vue-i18n |
| 桌面、本地业务 | Electron + Node.js，同源回环 HTTP 与最小 IPC |
| 图像计算 | 独立 OpenCV C++ 可执行文件，JSON Lines 协议 |
| 历史、设置 | Node 内置 SQLite / 原子 JSON 配置 |
| 打包 | Electron Forge，Mac 与 Windows 分别构建 |

```
HC-FrontEnd/src/   界面、状态与组件
locales/          共用中文、英语文案
electron/         窗口、HTTP、任务、SQLite、导出
native/           OpenCV C++ 计算程序
scripts/          跨平台构建入口
tests/            计算、API、导出与真实 Electron 验收
```

## 开发

需要 Node.js 24、CMake 3.24+ 和 C++17 编译器。macOS 安装 Xcode Command Line Tools 与 Ninja；Windows 安装 Visual Studio 2022 的 Desktop development with C++ 与 CMake。

```sh
npm ci
npm run build:native
npm run dev
```

首次构建从固定 URL 下载经过 SHA-256 校验的 OpenCV 4.12.0 和 nlohmann/json 3.12.0，仅编译 core、imgproc、imgcodecs。开发模式由 Electron 管理 Vite，无须手工启动计算服务。`npm start` 使用已构建前端。

## 使用

1. 在设置中标定真实剖面宽、高；默认均为 50 cm。界面分辨率默认 500×500。
2. 选择自动识别、HSV 或二值分析，调整染色阈值；所有有效设置自动保存，无须确认。
3. 导入图片或文件夹。整批使用导入时的同一份参数快照；修改设置只影响新批次。
4. 查看七项指标、深度曲线、参考线和两种聚类统计。
5. 按需要导出单项、完整分析包，或整个批次的结果。

每张图片上限 20 MB、3000 万像素，处理分辨率为 64–2000 px。批量导入逐张读取并保持有限在途任务，不会把整个目录的图片内容同时载入内存。二值图约定黑色为染色，白色为背景。

CSV、JSON 使用固定英文列名便于科研软件读取；界面、错误与原生操作支持中英切换。Excel 矩阵不含参考线，灰度值为 0 / 255。

## 构建和验证

```sh
npm run build:ui
npm test
npm run test:desktop
npm run make
```

`npm run make` 自动构建前端与计算程序，再调用 Forge。macOS 输出 `.dmg` / `.zip`，Windows 输出 Squirrel 安装包 / `.zip`。工作流对 Apple Silicon Mac、Intel Mac、Windows x64 分别编译、测试并打包。

Mac 也可以生成 Windows x64 包：安装 `mingw-w64`、`mono`、`sevenzip` 和 Ninja，然后执行：

```sh
npm run build:ui
npm run build:windows-worker
npm run make:windows
```

交叉编译的 Windows 工作进程独立保存在 `dist/win32-x64/worker`，不会覆盖 Mac 版本。安装器继续使用 Forge/Squirrel，由本机 Mono、7-Zip 和 PE 资源工具生成，无须安装 Wine。该过程生成真实 Windows x64 二进制，但不等于已完成 Windows 实机运行验收。

用户无需安装 Node、CMake 或 OpenCV。默认发行包未配置开发者签名与 Apple 公证，正式公开发行时需配置相应签名身份；当前不创建发布版或自动更新渠道。

设置和数据库位于 Electron 的用户数据目录，可在设置页直接打开。历史删除会同时移除该项计算的图像与数据，不删除原始导入文件。
