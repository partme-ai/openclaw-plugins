import { describe, expect, it } from "vitest";

import {
  captureWeixinReplyWorkspace,
  runWithWeixinReplyWorkspace,
} from "../../src/media/reply-workspace.js";

describe("trusted workspace for one Weixin reply turn", () => {
  it("accepts only the host workspace for the routed agent and session", async () => {
    const active = { agentId: "main", sessionKey: "agent:main:direct:current" };

    await runWithWeixinReplyWorkspace(active, async () => {
      captureWeixinReplyWorkspace({
        agentId: "main",
        sessionKey: "agent:main:direct:sibling",
        workspaceDir: "/trusted/sandboxes/sibling",
      });
      captureWeixinReplyWorkspace({
        agentId: "other",
        sessionKey: "agent:main:direct:current",
        workspaceDir: "/trusted/sandboxes/sibling",
      });
      expect(active).not.toHaveProperty("workspaceDir");

      captureWeixinReplyWorkspace({
        agentId: "main",
        sessionKey: "agent:main:direct:current",
        workspaceDir: "/trusted/sandboxes/current",
      });
      expect(active).toHaveProperty("workspaceDir", "/trusted/sandboxes/current");

      captureWeixinReplyWorkspace({
        agentId: "main",
        sessionKey: "agent:main:direct:sibling",
        workspaceDir: "/trusted/sandboxes/sibling",
      });
      expect(active).toHaveProperty("workspaceDir", "/trusted/sandboxes/current");
    });
  });

  it("does not capture a hook after its reply turn finishes", async () => {
    const active = { agentId: "main", sessionKey: "agent:main:direct:current" };
    await runWithWeixinReplyWorkspace(active, async () => undefined);

    captureWeixinReplyWorkspace({
      agentId: "main",
      sessionKey: "agent:main:direct:current",
      workspaceDir: "/trusted/sandboxes/current",
    });
    expect(active).not.toHaveProperty("workspaceDir");
  });
});
