/**
 * @module util/index
 *
 * util 模块 barrel export / Public re-exports for util helpers.
 *
 * **关键导出**：超时、截断、模板、单例、错误格式化、TTL 存储等工具函数。
 */

export {
  withTimeout,
  AsyncTimeoutError,
  TimeoutError,
} from "./async-timeout.js";
export { truncateUtf8Bytes } from "./truncate-utf8-bytes.js";
export { splitUtf8TextByMaxBytes } from "./split-utf8-bytes.js";
export { formatTemplate } from "./format-template.js";
export { getGlobalSingleton, resetGlobalSingleton } from "./global-singleton.js";
export { formatErrorMessage, formatErrorMessageSync } from "./format-error.js";
export {
  createTtlMapStore,
  createReqIdStore,
  type TtlMapStore,
  type TtlMapStoreOptions,
  type ReqIdStore,
  type ReqIdStoreOptions,
} from "./ttl-map-store.js";
