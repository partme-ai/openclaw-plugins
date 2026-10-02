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

describe("WebSocket 持久入站结算", () => {
  it("Agent 处理失败后重试和重复投递都由 SDK journal 判断", async () => {
    setWebsocketRuntime({} as never);
    setWebsocketChannelConfig({ ...DEFAULT_WEBSOCKET_CONFIG, defaultAgentId: "main" });
    bridge.dispatchChannelMessage
      .mockRejectedValueOnce(new Error("agent unavailable"))
      .mockResolvedValue({ deliveryOutcome: { kind: "delivered" } });
    const message = {
      connectionId: "server-connection",
      rawPayload: JSON.stringify({ type: "message", text: "retry me", messageId: "retry-after-failure" }),
      messageId: "retry-after-failure",
      peerId: "stable-user",
    };

    await expect(handleInboundMessage(message)).rejects.toThrow("agent unavailable");
    await expect(handleInboundMessage(message)).resolves.toBeUndefined();
    await expect(handleInboundMessage(message)).resolves.toBeUndefined();

    expect(bridge.dispatchChannelMessage).toHaveBeenCalledTimes(3);
    expect(bridge.dispatchChannelMessage.mock.calls[0][0]).toMatchObject({
      deliveryIdentity: expect.any(String), requireDeliveryIdentity: true,
    });
  });

  it("does not acknowledge an inflight duplicate before the SDK settles it", async () => {
    setWebsocketRuntime({} as never);
    setWebsocketChannelConfig({ ...DEFAULT_WEBSOCKET_CONFIG, defaultAgentId: "main" });
    let finishFirst!: () => void;
    bridge.dispatchChannelMessage.mockImplementationOnce(() => new Promise((resolve) => {
      finishFirst = () => resolve({ deliveryOutcome: { kind: "delivered" } });
    }));
    bridge.dispatchChannelMessage.mockRejectedValueOnce(new Error("pending durable delivery"));
    const message = { connectionId: "c", peerId: "stable-user", messageId: "inflight", rawPayload: '{"type":"message","text":"hello","messageId":"inflight"}' };
    const first = handleInboundMessage(message);
    await vi.waitFor(() => expect(bridge.dispatchChannelMessage).toHaveBeenCalledTimes(1));
    await expect(handleInboundMessage(message)).rejects.toThrow("pending durable delivery");
    finishFirst();
    await first;
  });

  it("keeps old frames without an application messageId on best-effort dispatch", async () => {
    setWebsocketRuntime({} as never);
    setWebsocketChannelConfig({ ...DEFAULT_WEBSOCKET_CONFIG, defaultAgentId: "main" });
    bridge.dispatchChannelMessage.mockResolvedValue({ deliveryOutcome: { kind: "delivered" } });
    await handleInboundMessage({ connectionId: "c", rawPayload: '{"type":"message","text":"hello"}' });
    expect(bridge.dispatchChannelMessage.mock.calls[0][0].deliveryIdentity).toBeUndefined();
  });

  it("uses stable peer scope across reconnects and avoids a global missing-peer namespace", async () => {
    setWebsocketRuntime({} as never);
    setWebsocketChannelConfig({ ...DEFAULT_WEBSOCKET_CONFIG, defaultAgentId: "main" });
    bridge.dispatchChannelMessage.mockResolvedValue({ deliveryOutcome: { kind: "delivered" } });
    const base = { messageId: "same", rawPayload: '{"type":"message","text":"hello","messageId":"same"}' };
    await handleInboundMessage({ ...base, connectionId: "conn-1", peerId: "alice" });
    await handleInboundMessage({ ...base, connectionId: "conn-2", peerId: "alice" });
    await handleInboundMessage({ ...base, connectionId: "conn-3", peerId: "bob" });
    const calls = bridge.dispatchChannelMessage.mock.calls.map(([args]) => args);
    expect(calls[0].deliveryIdentity).toBe(calls[1].deliveryIdentity);
    expect(calls[0].deliveryFingerprintContext).toEqual(calls[1].deliveryFingerprintContext);
    expect(calls[2].deliveryIdentity).not.toBe(calls[0].deliveryIdentity);
    await handleInboundMessage({ ...base, connectionId: "conn-4" });
    expect(bridge.dispatchChannelMessage.mock.calls[3][0].deliveryIdentity).toBeUndefined();
  });

  it("uses one durable identity so the SDK can reject a changed body", async () => {
    setWebsocketRuntime({} as never);
    setWebsocketChannelConfig({ ...DEFAULT_WEBSOCKET_CONFIG, defaultAgentId: "main" });
    bridge.dispatchChannelMessage.mockResolvedValue({ deliveryOutcome: { kind: "delivered" } });
    await handleInboundMessage({ connectionId: "c", peerId: "stable-user", messageId: "same", rawPayload: '{"type":"message","text":"first","messageId":"same"}' });
    await handleInboundMessage({ connectionId: "c", peerId: "stable-user", messageId: "same", rawPayload: '{"type":"message","text":"second","messageId":"same"}' });
    expect(bridge.dispatchChannelMessage.mock.calls[0][0].deliveryIdentity).toBe(bridge.dispatchChannelMessage.mock.calls[1][0].deliveryIdentity);
  });
});
