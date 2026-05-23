/**
 * KF Webhook 模块导出。
 */
export { createKfCallbackHandler, consumeAccountStatePatch, primeWecomKfCursor } from "./callback.js";
export { processKfEvent, trackAccountEvent } from "./handler.js";
