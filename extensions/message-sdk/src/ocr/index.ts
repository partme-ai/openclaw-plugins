/**
 * @module ocr
 *
 * OCR 模块 — 光学字符识别（Optical Character Recognition）。
 *
 * **默认提供商**：
 * - DeepSeek Vision (`deepseek-chat`)
 * - GLM-4V（智谱 AI）
 * - PaddleOCR（百度 PP-OCRv4，自部署）
 * - 百度千帆（ERNIE-4.0）
 *
 * **扩展新提供商**：见模块内注释步骤。
 *
 * **关键导出**：`recognizeDeepSeek`、`recognizeGLM`、`recognizePaddleOCR`、`recognizeQianfan`
 */

export * from "./errors.js";
export * from "./types.js";
export { recognizeDeepSeek } from "./deepseek.js";
export { recognizeGLM } from "./glm.js";
export { recognizePaddleOCR } from "./paddleocr.js";
export { recognizeQianfan } from "./qianfan.js";
