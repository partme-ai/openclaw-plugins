/**
 * Web STOMP outbound 薄封装单元测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/transport/server.js", () => ({
  publishToDestination: vi.fn(),
}));

import { publishToDestination } from "../src/transport/server.js";
import { publishOutboundMessage } from "../src/outbound.js";

describe("publishOutboundMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to publishToDestination", () => {
    publishOutboundMessage("/topic/session.demo", "wire");
    expect(publishToDestination).toHaveBeenCalledWith("/topic/session.demo", "wire");
  });
});
