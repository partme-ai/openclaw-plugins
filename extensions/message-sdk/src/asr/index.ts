/**
 * @module asr
 *
 * ASR 模块 — 语音识别（Automatic Speech Recognition）。
 *
 * **职责**：将音频 Buffer 转为文本；各提供商共用统一错误体系。
 *
 * **来源**：openclaw-china packages/shared/src/asr/ (MIT License)
 *
 * **扩展新提供商**：
 * 1. `import { ASRError, ... } from "./errors.js"`
 * 2. 实现 `transcribeXxx()` 函数
 * 3. 在本 index 中 export
 *
 * **关键导出**：`transcribeTencentFlash`、ASR 错误类
 */

export * from "./errors.js";
export * from "./tencent-flash.js";
