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
}));

vi.mock("../src/runtime.js", () => ({ getMqttRuntime: () => ({}) }));
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
vi.mock("../src/shared/wire-helpers.js", () => ({
  getMqttIdempotencyCache: () => ({}),
}));
vi.mock("@partme.ai/openclaw-message-sdk/bridge", () => ({
  normalizeWireIngress: () => ({
    accepted: true,
    text: "hello",
    unified: null,
  }),
  resolveChannelDispatchIdentity: async () => ({
    agentId: "main",
    sessionKey: "agent:main:mqtt:default:direct:device-1",
  }),
  dispatchChannelMessage: mocks.dispatchChannelMessage,
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
    resetSessionMappings();
    mocks.getClientUsername.mockReturnValue(undefined);
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
    await handleInboundMessage(message);
    expect(mocks.dispatchChannelMessage).toHaveBeenCalledTimes(1);
  });
});
