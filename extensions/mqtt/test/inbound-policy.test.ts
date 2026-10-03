/**
 * MQTT 入站第二层 ACL 的失败关闭测试。
 *
 * Broker publish ACL 是第一层；本文件验证消息进入 OpenClaw 路由前，认证身份丢失时不会绕过
 * account/inbound ACL。认证关闭的 loopback 开发模式则仍可正常进入 dispatch。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchChannelMessage: vi.fn().mockResolvedValue(undefined),
  logAuditEvent: vi.fn(),
  getClientUsername: vi.fn<() => string | undefined>(),
  getMqttChannelConfig: vi.fn(),
  getMqttRuntime: vi.fn((): object | undefined => ({})),
  normalizeWireIngress: vi.fn((_options?: { idempotency?: unknown }) => ({ accepted: true, text: "hello", unified: null })),
}));

vi.mock("../src/runtime.js", () => ({ getMqttRuntime: mocks.getMqttRuntime }));
vi.mock("../src/state/mqtt-state.js", () => ({
  getMqttChannelConfig: mocks.getMqttChannelConfig,
}));
vi.mock("../src/transport/server.js", () => ({
  getClientUsername: mocks.getClientUsername,
  publishMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/transport/audit.js", () => ({ logAuditEvent: mocks.logAuditEvent }));
vi.mock("../src/transport/acl.js", () => ({
  isUserActionAllowed: vi.fn(() => true),
}));
vi.mock("@partme.ai/openclaw-message-sdk/bridge", () => ({
  normalizeWireIngress: mocks.normalizeWireIngress,
  resolveChannelDispatchIdentity: async () => ({
    agentId: "main",
    sessionKey: "agent:main:mqtt:default:direct:device-1",
  }),
  dispatchChannelMessage: mocks.dispatchChannelMessage,
  requireSettledDelivery: () => undefined,
}));

import { handleInboundMessage } from "../src/inbound.js";
import { resetSessionMappings } from "../src/routing/session-mapper.js";

const message = {
  clientId: "device-1",
  topic: "openclaw/agent/main/in",
  payload: Buffer.from("hello"),
  qos: 1 as const,
  retain: false,
  dup: false,
};

function config(authEnabled: boolean) {
  return {
    subscribeTopics: ["openclaw/agent/+/in"],
    topicBindings: [],
    payload: { mode: "jsonTextOrPlain" },
    retain: { allowInboundRetain: true, outboundRetain: false },
    audit: { enabled: true, format: "json" },
    auth: {
      enabled: authEnabled,
      allowAnonymous: false,
      users: [
        {
          username: "device-user",
          aclRules: [
            {
              action: "inbound",
              topicPattern: "openclaw/agent/+/in",
              effect: "allow",
              accountId: "default",
            },
          ],
        },
      ],
    },
  };
}

describe("MQTT inbound authenticated identity policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dispatchChannelMessage.mockResolvedValue(undefined);
    resetSessionMappings();
    mocks.getClientUsername.mockReturnValue(undefined);
    mocks.getMqttRuntime.mockReturnValue({});
  });

  it("rejects an otherwise routable publish when the runtime is not initialized", async () => {
    mocks.getMqttChannelConfig.mockReturnValue(config(false));
    mocks.getMqttRuntime.mockReturnValue(undefined);
    await expect(handleInboundMessage(message)).rejects.toThrow("Runtime not initialized");
    expect(mocks.dispatchChannelMessage).not.toHaveBeenCalled();
  });

  it("rejects a publish when the runtime disappears before dispatch", async () => {
    mocks.getMqttChannelConfig.mockReturnValue(config(false));
    mocks.getMqttRuntime.mockReturnValueOnce({}).mockReturnValueOnce(undefined);
    await expect(handleInboundMessage(message)).rejects.toThrow("Runtime not initialized");
    expect(mocks.dispatchChannelMessage).not.toHaveBeenCalled();
  });

  it("drops authenticated traffic when the client identity mapping is missing", async () => {
    mocks.getMqttChannelConfig.mockReturnValue(config(true));
    await handleInboundMessage(message);

    expect(mocks.dispatchChannelMessage).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "warn",
      "acl_inbound_identity_missing",
      expect.objectContaining({ clientId: "device-1", accountId: "default" }),
    );
  });

  it("allows identity-free traffic only when broker authentication is disabled", async () => {
    mocks.getMqttChannelConfig.mockReturnValue(config(false));
    await handleInboundMessage({ ...message, payload: Buffer.from('{"text":"hello","idempotencyKey":"application-1"}') });
    expect(mocks.dispatchChannelMessage).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchChannelMessage.mock.calls[0][0]).toMatchObject({ deliveryIdentity: expect.any(String), requireDeliveryIdentity: true });
  });

  it("keeps plain text best-effort without treating reusable packet IDs as durable", async () => {
    mocks.getMqttChannelConfig.mockReturnValue(config(false));
    await handleInboundMessage({ ...message, messageId: 7 });
    expect(mocks.dispatchChannelMessage.mock.calls[0][0]).toMatchObject({
      deliveryIdentity: undefined, requireDeliveryIdentity: false,
    });
  });

  it("propagates Agent dispatch failure so a QoS retry can reach the journal", async () => {
    mocks.getMqttChannelConfig.mockReturnValue(config(false));
    mocks.dispatchChannelMessage.mockRejectedValueOnce(new Error("agent unavailable"));

    await expect(handleInboundMessage({ ...message, payload: Buffer.from('{"text":"hello","idempotencyKey":"application-2"}'), messageId: 7 })).rejects.toThrow("agent unavailable");

    await handleInboundMessage({ ...message, payload: Buffer.from('{"text":"hello","idempotencyKey":"application-2"}'), messageId: 7, dup: true });
    expect(mocks.dispatchChannelMessage).toHaveBeenCalledTimes(2);
  });

  it("does not let a packet cache acknowledge a duplicate before journal settlement", async () => {
    mocks.getMqttChannelConfig.mockReturnValue(config(false));
    const input = { ...message, payload: Buffer.from('{"text":"hello","idempotencyKey":"application-3"}'), messageId: 7 };
    await handleInboundMessage(input);
    mocks.normalizeWireIngress.mockImplementationOnce((options) => options.idempotency
      ? { accepted: false, text: "", unified: null }
      : { accepted: true, text: "hello", unified: null });
    await handleInboundMessage({ ...input, dup: true });
    expect(mocks.dispatchChannelMessage).toHaveBeenCalledTimes(2);
  });

  it("uses one durable identity so the SDK can reject a changed payload", async () => {
    mocks.getMqttChannelConfig.mockReturnValue(config(false));
    await handleInboundMessage({ ...message, payload: Buffer.from('{"text":"first","idempotencyKey":"same"}') });
    await handleInboundMessage({ ...message, payload: Buffer.from('{"text":"second","idempotencyKey":"same"}') });
    expect(mocks.dispatchChannelMessage.mock.calls[0][0].deliveryIdentity).toBe(mocks.dispatchChannelMessage.mock.calls[1][0].deliveryIdentity);
  });

  it("separates authenticated owners when a clientId is taken over", async () => {
    const cfg = config(true);
    cfg.auth.users = [{ username: "alice" }, { username: "bob" }];
    mocks.getMqttChannelConfig.mockReturnValue(cfg);
    mocks.getClientUsername.mockReturnValue("bob");
    const payload = Buffer.from('{"text":"hello","idempotencyKey":"same-app-id"}');
    await handleInboundMessage({ ...message, payload, authenticatedUsername: "alice" });
    await handleInboundMessage({ ...message, payload, authenticatedUsername: "bob" });
    const calls = mocks.dispatchChannelMessage.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].deliveryIdentity).not.toBe(calls[1][0].deliveryIdentity);
    expect(mocks.getClientUsername).not.toHaveBeenCalled();
  });
});
