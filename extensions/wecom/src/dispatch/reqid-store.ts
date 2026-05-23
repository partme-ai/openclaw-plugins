/**
 * @module reqid-store
 *
 * ReqId 持久化存储 — message-sdk 薄 re-export。
 *
 * **职责**：提供 `createPersistentReqIdStore` 工厂与 `PersistentReqIdStore` 类型，
 * 供需要磁盘持久化 reqId 的场景使用（当前 WeCom WS 主链路使用内存 store，见 `state-manager`）。
 *
 * **适用场景**：扩展模块或未来持久化 reqId 需求。
 *
 * **关键导出**：`createPersistentReqIdStore`、`PersistentReqIdStore`
 */

export {
  createReqIdStore as createPersistentReqIdStore,
  type ReqIdStore as PersistentReqIdStore,
} from "@partme.ai/openclaw-message-sdk/util";
