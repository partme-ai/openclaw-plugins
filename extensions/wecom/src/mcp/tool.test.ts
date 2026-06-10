import { beforeEach, describe, expect, it, vi } from "vitest";

const sendJsonRpcMock = vi.hoisted(() => vi.fn());
const resolveBeforeCallMock = vi.hoisted(() => vi.fn());
const runAfterCallMock = vi.hoisted(() => vi.fn());
const isWeComMcpDebugEnabledMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("./transport.js", () => ({
  sendJsonRpc: sendJsonRpcMock,
}));

vi.mock("./interceptors/index.js", () => ({
  resolveBeforeCall: resolveBeforeCallMock,
  runAfterCall: runAfterCallMock,
}));

vi.mock("./debug-log.js", () => ({
  isWeComMcpDebugEnabled: isWeComMcpDebugEnabledMock,
  mcpDebugLog: vi.fn(),
}));

import { createWeComMcpTool } from "./tool.js";

describe("createWeComMcpTool", () => {
  beforeEach(() => {
    sendJsonRpcMock.mockReset();
    resolveBeforeCallMock.mockReset();
    runAfterCallMock.mockReset();
    isWeComMcpDebugEnabledMock.mockReturnValue(false);
    resolveBeforeCallMock.mockResolvedValue({});
    runAfterCallMock.mockImplementation(async (_ctx: unknown, result: unknown) => result);
  });

  it("passes trusted requester userid to tools/list requests", async () => {
    sendJsonRpcMock.mockResolvedValue({ tools: [] });

    const tool = createWeComMcpTool({ requesterUserId: "  wecom-user-1  " });
    await tool.execute("tool-call-1", {
      action: "list",
      category: "contact",
    });

    expect(sendJsonRpcMock).toHaveBeenCalledWith(
      "contact",
      "tools/list",
      undefined,
      { requesterUserId: "wecom-user-1" },
    );
  });

  it("merges interceptor options with trusted requester userid for tools/call", async () => {
    sendJsonRpcMock.mockResolvedValue({ ok: true });
    resolveBeforeCallMock.mockResolvedValue({
      options: { timeoutMs: 45_000 },
      args: { replaced: true },
    });

    const tool = createWeComMcpTool({ requesterUserId: "wecom-user-2" });
    await tool.execute("tool-call-2", {
      action: "call",
      category: "doc",
      method: "smartpage_create",
      args: JSON.stringify({ original: true }),
    });

    expect(sendJsonRpcMock).toHaveBeenCalledWith(
      "doc",
      "tools/call",
      {
        name: "smartpage_create",
        arguments: { replaced: true },
      },
      {
        timeoutMs: 45_000,
        requesterUserId: "wecom-user-2",
      },
    );
  });

  it("does not stringify large args in handleCall logs when debug is off", async () => {
    sendJsonRpcMock.mockResolvedValue({ ok: true });
    resolveBeforeCallMock.mockResolvedValue({
      options: { timeoutMs: 45_000 },
      args: { replaced: true },
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const tool = createWeComMcpTool({ requesterUserId: "wecom-user-3" });
    await tool.execute("tool-call-3", {
      action: "call",
      category: "doc",
      method: "smartpage_create",
      args: { big: "x".repeat(5000) },
    });

    const joined = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(joined).not.toContain('"big"');
    expect(joined).toContain("(debug off)");
  });
});
