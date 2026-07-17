import { afterEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  dispatchChannelMessage: vi.fn(),
  resolveChannelDispatchIdentity: vi.fn(async () => ({ agentId: "main", sessionKey: "agent:main:web-socket:test" })),
}));

vi.mock("@partme.ai/openclaw-message-sdk/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@partme.ai/openclaw-message-sdk/bridge")>();
  return { ...actual, ...bridge };
});

import { DEFAULT_WEBSOCKET_CONFIG } from "../src/config.js";
import { handleInboundMessage } from "../src/inbound.js";
import { clearSessionMappings } from "../src/routing/session-mapper.js";
import { setWebsocketRuntime } from "../src/runtime.js";
import { setWebsocketChannelConfig } from "../src/state/web-socket-state.js";

afterEach(() => {
  bridge.dispatchChannelMessage.mockReset();
  clearSessionMappings();
  setWebsocketChannelConfig(null);
});

describe("WebSocket 入站两阶段去重", () => {
  it("Agent 处理失败会释放 messageId，重试成功后才提交去重记录", async () => {
    setWebsocketRuntime({} as never);
    setWebsocketChannelConfig({ ...DEFAULT_WEBSOCKET_CONFIG, defaultAgentId: "main" });
    bridge.dispatchChannelMessage
      .mockRejectedValueOnce(new Error("agent unavailable"))
      .mockResolvedValueOnce(undefined);
    const message = {
      connectionId: "server-connection",
      rawPayload: JSON.stringify({ type: "message", text: "retry me", messageId: "retry-after-failure" }),
      messageId: "retry-after-failure",
    };

    await expect(handleInboundMessage(message)).rejects.toThrow("agent unavailable");
    await expect(handleInboundMessage(message)).resolves.toBeUndefined();
    await expect(handleInboundMessage(message)).resolves.toBeUndefined();

    expect(bridge.dispatchChannelMessage).toHaveBeenCalledTimes(2);
  });
});
