import { describe, expect, it, vi } from "vitest";
import { probeWeComAccount } from "./probe.js";
import type { ResolvedWeComAccount } from "./utils.js";

vi.mock("./agent/api-client.js", () => ({
  getAccessToken: vi.fn(async () => "token"),
}));

vi.mock("./state-manager.js", () => ({
  getWeComWebSocket: vi.fn(() => null),
}));

describe("probeWeComAccount", () => {
  it("returns ok when agent credentials work", async () => {
    const account = {
      accountId: "default",
      agent: { configured: true, corpId: "c", corpSecret: "s" },
    } as ResolvedWeComAccount;
    const result = await probeWeComAccount(account);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("returns ok for bot credentials when WS not connected", async () => {
    const account = {
      accountId: "default",
      botId: "bot",
      secret: "sec",
    } as ResolvedWeComAccount;
    const result = await probeWeComAccount(account);
    expect(result.ok).toBe(true);
    expect(result.error).toMatch(/websocket not connected/i);
  });

  it("returns not configured when empty", async () => {
    const account = { accountId: "default" } as ResolvedWeComAccount;
    const result = await probeWeComAccount(account);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });
});
