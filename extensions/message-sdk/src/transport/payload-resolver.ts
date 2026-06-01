/**
 * @module message-sdk/transport/payload-resolver
 *
 * 统一 Wire payload 模式映射。
 *
 * stomp / web-stomp / web-mqtt 各自定义了 `mapXxxWirePayloadMode()`，
 * 逻辑完全一致，收敛到此处。
 */

import type { PayloadParseMode } from "../pipeline/parse-payload.js";

/**
 * 将插件配置中的 payload 模式映射为 message-sdk PayloadParseMode。
 *
 * @param mode - 配置中的模式字符串（如 `"jsonTextOrPlain"`）
 * @returns 对应的 PayloadParseMode
 */
export function resolvePayloadMode(mode: string): PayloadParseMode {
  if (mode === "jsonTextOrPlain") return "jsonTextOrPlain";
  if (mode === "jsonOnly") return "jsonOnly";
  return "plain";
}
