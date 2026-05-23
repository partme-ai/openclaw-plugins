import { describe, expect, it } from "vitest";
import {
  processDynamicPeerRouting,
  sanitizeDynamicIdPart,
  shouldUseDynamicPeerAgent,
} from "./dynamic-peer-agent.js";

describe("dynamic-peer-agent", () => {
  it("skips when matchedBy is not default", () => {
    const result = processDynamicPeerRouting({
      route: {
        agentId: "main",
        sessionKey: "sk",
        matchedBy: "binding",
        accountId: "a1",
      },
      chatType: "dm",
      peerId: "u1",
      accountId: "a1",
      senderId: "u1",
      dynamicConfig: { enabled: true, dmCreateAgent: true, groupEnabled: true, adminUsers: [] },
      buildAgentId: () => "dyn",
      buildSessionKey: () => "dyn-sk",
    });
    expect(result.routeModified).toBe(false);
  });

  it("injects dynamic agent when enabled", () => {
    const result = processDynamicPeerRouting({
      route: {
        agentId: "main",
        sessionKey: "sk",
        matchedBy: "default",
        accountId: "a1",
      },
      chatType: "dm",
      peerId: "User-1",
      accountId: "a1",
      senderId: "u1",
      dynamicConfig: { enabled: true, dmCreateAgent: true, groupEnabled: true, adminUsers: [] },
      buildAgentId: ({ peerId }) => `dyn-${sanitizeDynamicIdPart(peerId)}`,
      buildSessionKey: ({ agentId }) => `agent:${agentId}`,
    });
    expect(result.routeModified).toBe(true);
    expect(result.finalAgentId).toBe("dyn-user-1");
  });

  it("admin bypasses dynamic agent", () => {
    expect(
      shouldUseDynamicPeerAgent({
        chatType: "dm",
        senderId: "Admin",
        dynamicConfig: {
          enabled: true,
          dmCreateAgent: true,
          groupEnabled: true,
          adminUsers: ["admin"],
        },
      }),
    ).toBe(false);
  });
});
