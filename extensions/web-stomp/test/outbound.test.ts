/**
 * Web STOMP outbound 薄封装单元测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/transport/server.js", () => ({
  publishToDestination: vi.fn().mockReturnValue(1),
}));

import { publishToDestination } from "../src/transport/server.js";
import { publishOutboundMessage } from "../src/outbound.js";

describe("publishOutboundMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(publishToDestination).mockReturnValue(1);
  });

  it("delegates to publishToDestination", () => {
    publishOutboundMessage("/topic/session.demo", "wire");
    expect(publishToDestination).toHaveBeenCalledWith("/topic/session.demo", "wire");
  });

  it("throws when no subscriber accepts the delivery", () => {
    vi.mocked(publishToDestination).mockReturnValue(0);
    expect(() => publishOutboundMessage("/topic/session.demo", "wire")).toThrow(/No Web STOMP subscriber/);
  });
});
