import { describe, expect, it, vi } from "vitest";

vi.mock("../src/runtime.js", () => ({ getMqttRuntime: vi.fn(() => null) }));
vi.mock("../src/state/mqtt-state.js", () => ({
  getMqttChannelConfig: vi.fn(() => ({
    retain: { allowInboundRetain: true },
    subscribeTopics: [],
    payload: { mode: "plain", outboundFormat: "envelope" },
    audit: { enabled: false },
    auth: { users: [] },
  })),
}));
vi.mock("../src/routing/topic-router.js", () => ({
  resolveInboundRoute: vi.fn(() => null),
  buildReplyTopicFromInbound: vi.fn(),
  matchTopic: vi.fn(),
}));
vi.mock("../src/routing/session-mapper.js", () => ({
  getOrCreateSessionKey: vi.fn(),
  upsertSessionContext: vi.fn(),
}));
vi.mock("../src/transport/audit.js", () => ({ logAuditEvent: vi.fn() }));
vi.mock("../src/transport/server.js", () => ({ getClientUsername: vi.fn() }));
vi.mock("../src/transport/acl.js", () => ({ isUserActionAllowed: vi.fn(() => true) }));

import * as bridge from "@partme.ai/openclaw-message-sdk/bridge";
import { buildMqttPacketIdempotencyKey } from "../src/shared/wire-helpers.js";

describe("mqtt inbound wire path", () => {
  it("uses dispatchWireMessage not runAssembled", async () => {
    expect(bridge.dispatchWireMessage).toBeTypeOf("function");
    expect((bridge as { dispatchTranscriptTurn?: unknown }).dispatchTranscriptTurn).toBeUndefined();
  });

  it("scopes MQTT packet identifiers by client, topic, and payload", () => {
    const base = {
      clientId: "device-a",
      topic: "openclaw/agent/main/in",
      payload: "hello",
      qos: 1 as const,
      retain: false,
      dup: false,
      messageId: 7,
    };
    const key = buildMqttPacketIdempotencyKey(base);

    expect(key).toBe(buildMqttPacketIdempotencyKey({ ...base }));
    expect(key).not.toBe(buildMqttPacketIdempotencyKey({ ...base, clientId: "device-b" }));
    expect(key).not.toBe(buildMqttPacketIdempotencyKey({ ...base, topic: "other/topic" }));
    expect(key).not.toBe(buildMqttPacketIdempotencyKey({ ...base, payload: "next" }));
    expect(buildMqttPacketIdempotencyKey({ ...base, messageId: undefined })).toBeUndefined();
    expect(key).not.toContain("hello");
  });
});
