/**
 * @module ocr
 *
 * OCR 模块 — 光学字符识别（Optical Character Recognition）。
 *
 * **已验证的协议实现**：
 * - GLM-4.5V（智谱 AI 官方多模态 Chat API）
 * - PaddleOCR（PP-OCRv4 自部署 HTTP 服务）
 *
 * DeepSeek Chat 当前官方协议只接受文本 content；原 `image_url` 实现无法真实工作，已删除。
 * 原千帆实现把 API Key 直接当 access token 且使用未验证的 ERNIE 图像消息，也已删除。
 *
 * **扩展新提供商**：见模块内注释步骤。
 *
 * **关键导出**：`recognizeGLM`、`recognizePaddleOCR`
 */

export * from "./errors.js";
export * from "./types.js";
export { recognizeGLM } from "./glm.js";
export { recognizePaddleOCR } from "./paddleocr.js";
