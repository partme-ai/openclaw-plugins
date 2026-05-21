# 多模态测试 Fixtures

本目录存放标准测试套件（L7–L9、X-01）引用的样例附件。  
**SVG 图像 fixture 已纳入仓库**（`images/`），可直接用于 L7 视觉/OCR/图表用例。  
音频、视频、PDF 等二进制样例请在本地或 CI 密钥库中添加，勿提交超大二进制到 git。

## SVG 图像（已提交）

路径前缀：`fixtures/images/`。Runner 将 `fixture_refs` 解析为 `openclaw-plugins/testing/fixtures/{path}`。

| 文件名 | 引用键 | 用例 ID | 尺寸 (viewBox) | 用途 |
|--------|--------|---------|----------------|------|
| `images/vision-smoke.svg` | `image_svg_smoke` | **L7-02** | 400×300 | 视觉冒烟：标题 `OPENCLAW VISION TEST`、红圆、蓝方 |
| `images/vision-ocr.svg` | `image_svg_ocr` | **L7-03** | 400×300 | OCR/可读性：数字 `12345`、中英混排 |
| `images/vision-chart.svg` | `image_svg_chart` | **L7-04** | 400×300 | 图表理解：Mon–Thu 柱状图，最高 Thu=80 |
| `images/vision-icon.svg` | `image_svg_icon` | **L7-05** | 128×128 | 小图标附件：紧凑 SVG icon |

> **L7-01** 使用 Wikimedia 公开 PNG URL，无需本地 fixture。CI 需允许出站 HTTPS。

### 兼容别名（旧 PNG 键名）

| 引用键 | 实际路径 | 说明 |
|--------|----------|------|
| `image_png_small` | `images/vision-smoke.svg` | 兼容 L7-02 旧键，指向 smoke fixture |
| `image_png_chart` | `images/vision-chart.svg` | 兼容扩展图表键，指向 chart fixture |

所有 SVG 为 **SVG 1.1**、自包含、无外部图片依赖；风格为浅色小清新背景。

## 二进制样例（本地/CI 添加）

| 文件名 | 引用键 | 用例 ID | 状态 | 建议规格 |
|--------|--------|---------|------|----------|
| `audio/sample-3s.wav` | `audio_wav_short` | L8-01 | **已提交** | 3s，16kHz mono |
| `audio/sample-voice.ogg` | `audio_ogg_voice` | 扩展 | **已提交** | <100KB |
| `audio/openclaw-asr-en.wav` | `audio_wav_en` | 扩展 | **已提交** | 英文 ASR 样例 |
| `audio/openclaw-asr-zh.wav` | `audio_wav_zh` | 扩展 | **已提交** | 中文 ASR 样例 |
| `video/sample-5s.mp4` | `video_mp4_short` | L9-01 | **未提交** | 5s，720p，<2MB；无文件时 capability skip |
| `files/sample-one-page.pdf` | `file_pdf_sample` | X-01 | **未提交** | 单页 PDF |
| `files/sample-archive.zip` | `file_zip_sample` | 扩展 | **未提交** | 小 zip |

## 生成占位文件（开发用）

```bash
# 最小 PNG（1x1 透明）— 仅用于通路测试，不用于 L7 语义断言
printf '\x89PNG\r\n\x1a\n' > sample-128x128.png
# L7 视觉断言请优先使用 fixtures/images/*.svg
```

## 路径解析

Runner 将 `fixture_refs` 解析为：

```
openclaw-plugins/testing/fixtures/{filename}
```

插件 adapter 负责读取并转为渠道所需格式（base64、multipart、media_id 等）。  
SVG 附件建议 MIME：`image/svg+xml`。
