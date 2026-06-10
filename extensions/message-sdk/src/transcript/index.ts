/**
 * @module transcript
 *
 * Transcript 模块 barrel export。
 *
 * **职责**：聚合流式回复链路所需的配置解析、模板、关流兜底、
 * reply dispatcher hooks 工厂等能力。
 *
 * **子模块概览**：
 * - `stream-state-types` — 流式状态与配置类型
 * - `streaming-config` — streaming/footer 解析与气泡拼接
 * - `text-config` / `templates` — 用户可见文案
 * - `finish-stream` — 关流兜底文案决策
 * - `reply-dispatcher-factory` — OpenClaw reply hooks 组合
 *
 * **上下游**：
 * - 上游：渠道 openclaw.json streaming / *Text 配置
 * - 下游：WeCom / Feishu stream session、OpenClaw reply dispatcher
 */

export * from "./stream-state-types.js";
export * from "./streaming-config.js";
export * from "./text-config.js";
export * from "./templates.js";
export * from "./finish-stream.js";
export * from "./reply-dispatcher-factory.js";
