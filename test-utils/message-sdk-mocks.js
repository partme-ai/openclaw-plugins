import { vi } from "vitest";

/**
 * Mock dispatchChannelMessage for inbound wiring tests.
 */
export function createMockDispatchChannelMessage() {
  return vi.fn(async () => ({ ok: true }));
}

/**
 * Partial mock of @partme.ai/openclaw-message-sdk for unit tests.
 * @param {Record<string, unknown>} [overrides]
 */
export function createMockMessageSdkModule(overrides = {}) {
  const dispatchChannelMessage = createMockDispatchChannelMessage();
  return {
    dispatchChannelMessage,
    resolveChannelDispatchIdentity: vi.fn(() => ({
      sessionKey: "agent:main:test:direct:peer-1",
      peerId: "peer-1",
    })),
    ...overrides,
  };
}
