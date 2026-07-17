/**
 * Web STOMP outbound 薄封装单元测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/transport/server.js", () => ({
  publishToDestination: vi.fn().mockResolvedValue(1),
}));

import { publishToDestination } from "../src/transport/server.js";
import { publishOutboundMessage } from "../src/outbound.js";

describe("publishOutboundMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(publishToDestination).mockResolvedValue(1);
  });

  it("delegates to publishToDestination", async () => {
    await publishOutboundMessage("/topic/session.demo", "wire");
    expect(publishToDestination).toHaveBeenCalledWith("/topic/session.demo", "wire");
  });

  it("throws when no subscriber accepts the delivery", async () => {
    vi.mocked(publishToDestination).mockResolvedValue(0);
    await expect(publishOutboundMessage("/topic/session.demo", "wire")).rejects.toThrow(/No Web STOMP subscriber/);
  });
});
