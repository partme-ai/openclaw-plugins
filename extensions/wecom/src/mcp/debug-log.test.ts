import { afterEach, describe, expect, it, vi } from "vitest";
import { isWeComMcpDebugEnabled, mcpDebugLog } from "./debug-log.js";

describe("mcp debug logging", () => {
  const originalWecom = process.env.WECOM_MCP_DEBUG;
  const originalOpenclaw = process.env.OPENCLAW_DEBUG;

  afterEach(() => {
    if (originalWecom === undefined) {
      delete process.env.WECOM_MCP_DEBUG;
    } else {
      process.env.WECOM_MCP_DEBUG = originalWecom;
    }
    if (originalOpenclaw === undefined) {
      delete process.env.OPENCLAW_DEBUG;
    } else {
      process.env.OPENCLAW_DEBUG = originalOpenclaw;
    }
    vi.restoreAllMocks();
  });

  it("is disabled by default", () => {
    delete process.env.WECOM_MCP_DEBUG;
    delete process.env.OPENCLAW_DEBUG;
    expect(isWeComMcpDebugEnabled()).toBe(false);
  });

  it("mcpDebugLog does not log when debug is off", () => {
    delete process.env.WECOM_MCP_DEBUG;
    delete process.env.OPENCLAW_DEBUG;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    mcpDebugLog("[mcp] heavy payload would go here");

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("mcpDebugLog logs when WECOM_MCP_DEBUG=1", () => {
    process.env.WECOM_MCP_DEBUG = "1";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    mcpDebugLog("[mcp] debug on");

    expect(logSpy).toHaveBeenCalledWith("[mcp] debug on");
  });
});
