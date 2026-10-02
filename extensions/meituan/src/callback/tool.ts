import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { MeituanCallbackInbox } from "./inbox.js";

export const MEITUAN_CALLBACK_TOOL_NAME = "meituan_callback_inbox";

/** 受信任 owner 读取、确认通知；回调文本不自动触发业务写操作。 */
export function createMeituanCallbackTool(ctx: OpenClawPluginToolContext<2>, inbox: MeituanCallbackInbox, maxResultBytes = 262_144) {
  return {
    name: MEITUAN_CALLBACK_TOOL_NAME,
    label: "美团通知收件箱",
    description: "列出、读取或确认已验签并持久化的美团通知和消息回调",
    parameters: {
      type: "object" as const, additionalProperties: false, required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "get", "ack"] },
        eventId: { type: "string", pattern: "^[a-f0-9]{64}$" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
    execute: async (_toolCallId: string, params: unknown) => {
      const output = async (value: unknown) => {
        const text = JSON.stringify(value);
        const bounded = Buffer.byteLength(text, "utf8") <= maxResultBytes
          ? text : JSON.stringify({ success: false, error: "callback result exceeds configured tool limit" });
        return { content: [{ type: "text" as const, text: bounded }], details: undefined };
      };
      if (ctx.senderIsOwner !== true) return output({ success: false, error: "owner required" });
      if (!params || typeof params !== "object" || Array.isArray(params)) return output({ success: false, error: "invalid parameters" });
      const input = params as Record<string, unknown>;
      try {
        if (input.action === "list") {
          const limit = input.limit === undefined ? 20 : input.limit;
          if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100) throw new Error("invalid limit");
          const entries = await inbox.list(limit as number);
          ctx.assertInvocationCurrent();
          return output({ success: true, data: entries.map(({ payload: _payload, messageRaw: _messageRaw, ...summary }) => summary) });
        }
        if (input.action !== "get" && input.action !== "ack") throw new Error("invalid action");
        if (typeof input.eventId !== "string" || !/^[a-f0-9]{64}$/u.test(input.eventId)) throw new Error("invalid eventId");
        const data = input.action === "get" ? await inbox.get(input.eventId) : await inbox.ack(input.eventId, ctx.assertInvocationCurrent);
        ctx.assertInvocationCurrent();
        return output({ success: true, data });
      } catch {
        return output({ success: false, error: "callback inbox operation failed" });
      }
    },
  };
}
