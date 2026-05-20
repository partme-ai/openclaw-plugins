/**
 * OCR 模块 — 光学字符识别
 *
 * 4 个默认提供商：
 * - DeepSeek Vision  (deepseek-chat)
 * - GLM-4V           (智谱 AI)
 * - PaddleOCR        (百度 PP-OCRv4, 自部署)
 * - 百度千帆          (ERNIE-4.0)
 *
 * 来源：借鉴 Spring AI OCR 示例 (spring-ai-ollama-ocr-*)
 *       + openclaw-china ASR 模块结构
 *
 * 新增 OCR 提供商：
 *   1. import { OCRError, ... } from "./errors.js"
 *   2. import { OCRInput, OCRConfig, OCRResult } from "./types.js"
 *   3. 实现 recognizeXxx() 函数
 *   4. 在 index.ts 中 export
 */

export * from "./errors.js";
export * from "./types.js";
export { recognizeDeepSeek } from "./deepseek.js";
export { recognizeGLM } from "./glm.js";
export { recognizePaddleOCR } from "./paddleocr.js";
export { recognizeQianfan } from "./qianfan.js";
