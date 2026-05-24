import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replyMock = vi.hoisted(() => vi.fn());
const generateReqIdMock = vi.hoisted(() => vi.fn((prefix: string) => `${prefix}-id`));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@wecom/aibot-node-sdk", () => ({
  generateReqId: generateReqIdMock,
}));

vi.mock("../state/state-manager.js", () => ({
  getWeComWebSocket: vi.fn(() => ({
    reply: replyMock,
  })),
}));

vi.mock("../runtime.js", () => ({
  getWeComRuntime: vi.fn(() => ({
    config: {
      loadConfig: () => ({}),
    },
  })),
}));

vi.mock("../config/accounts.js", () => ({
  resolveDefaultWeComAccountId: vi.fn(() => "default"),
  listWeComAccountIds: vi.fn(() => ["default"]),
  resolveWeComAccountMulti: vi.fn(() => ({ botId: "bot", secret: "secret" })),
}));

vi.mock("undici", () => ({
  fetch: fetchMock,
}));

const isWeComMcpDebugEnabledMock = vi.hoisted(() => vi.fn(() => false));
const mcpDebugLogMock = vi.hoisted(() => vi.fn());

vi.mock("./debug-log.js", () => ({
  isWeComMcpDebugEnabled: isWeComMcpDebugEnabledMock,
  mcpDebugLog: (message: string) => {
    if (isWeComMcpDebugEnabledMock()) mcpDebugLogMock(message);
  },
}));

import { WECOM_USERID_HEADER, clearCategoryCache, sendJsonRpc } from "./transport.js";

function createJsonRpcResponse(result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: "rpc-id", result }), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("sendJsonRpc requester userid header", () => {
  beforeEach(() => {
    replyMock.mockReset();
    generateReqIdMock.mockClear();
    fetchMock.mockReset();

    replyMock.mockResolvedValue({
      errcode: 0,
      body: { url: "https://mcp.example.com" },
    });

    fetchMock.mockImplementation(async () => createJsonRpcResponse({ tools: [] }));
  });

  afterEach(() => {
    clearCategoryCache("default", "contact");
    clearCategoryCache("default", "doc");
  });

  it("injects x-openclaw-wecom-userid on initialize and request when userid is provided", async () => {
    await sendJsonRpc("contact", "tools/list", undefined, {
      requesterUserId: "  wecom-user-1  ",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const seenHeaders = fetchMock.mock.calls.map(([, init]) =>
      (init as { headers?: Record<string, string> } | undefined)?.headers,
    );

    expect(seenHeaders[0]?.[WECOM_USERID_HEADER]).toBe("wecom-user-1");
    expect(seenHeaders[1]?.[WECOM_USERID_HEADER]).toBe("wecom-user-1");
  });

  it("does not send x-openclaw-wecom-userid when userid is absent", async () => {
    await sendJsonRpc("doc", "tools/list");

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const seenHeaders = fetchMock.mock.calls.map(([, init]) =>
      (init as { headers?: Record<string, string> } | undefined)?.headers,
    );

    expect(seenHeaders[0]?.[WECOM_USERID_HEADER]).toBeUndefined();
    expect(seenHeaders[1]?.[WECOM_USERID_HEADER]).toBeUndefined();
  });

  it("does not emit verbose mcpDebugLog when debug is off", async () => {
    isWeComMcpDebugEnabledMock.mockReturnValue(false);
    mcpDebugLogMock.mockClear();

    await sendJsonRpc("contact", "tools/list", undefined, {
      requesterUserId: "user-1",
    });

    expect(mcpDebugLogMock).not.toHaveBeenCalled();
  });

  it("emits mcpDebugLog when debug is on", async () => {
    isWeComMcpDebugEnabledMock.mockReturnValue(true);
    mcpDebugLogMock.mockClear();

    await sendJsonRpc("contact", "tools/list", undefined, {
      requesterUserId: "user-1",
    });

    expect(mcpDebugLogMock).toHaveBeenCalled();
  });
});
