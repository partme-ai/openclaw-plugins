/**
 * @file OpenClaw 运行时状态目录解析薄封装。
 *
 * @description 提供插件持久化 backlog cursor / 本地小型 JSON sidecar 文件所需的 **规范化状态根路径**，
 * 实际路径解析委托 `@partme.ai/openclaw-message-sdk`，以保证 Workspace / `$OPENCLAW_STATE_DIR`
 * 在多插件环境下语义一致。**模块角色**：基础设施 · Channel Plugin State root。
 *
 * @see resolveStateDir —— re-export OpenClaw message-sdk canonical resolver。
 */

export { resolveOpenClawStateDir as resolveStateDir } from "@partme.ai/openclaw-message-sdk/openclaw";
