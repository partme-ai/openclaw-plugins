import { describe, expect, it, vi } from "vitest";

vi.mock("../src/runtime.js", () => ({ getMqttRuntime: vi.fn(() => null) }));
vi.mock("../src/mqtt-state.js", () => ({
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

describe("mqtt inbound wire path", () => {
  it("uses dispatchWireMessage not runAssembled", async () => {
    expect(bridge.dispatchWireMessage).toBeTypeOf("function");
    expect((bridge as { dispatchTranscriptTurn?: unknown }).dispatchTranscriptTurn).toBeUndefined();
  });
});
