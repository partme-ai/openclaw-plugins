/**
 * ASR 模块 — 语音识别
 *
 * 来源：openclaw-china packages/shared/src/asr/ (MIT License)
 * 版权：原始版权归 openclaw-china 项目所有
 *
 * 新增 ASR 提供商：
 *   1. import { ASRError, ... } from "./errors.js"
 *   2. 实现 transcribeXxx() 函数
 *   3. 在 index.ts 中 export
 */

export * from "./errors.js";
export * from "./tencent-flash.js";
