/** WebSocket Connection Hub 的写出确认与背压边界测试。 */
import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import {
  registerConnection,
  sendToConnectionConfirmed,
  unregisterConnection,
} from "../src/transport/connection-hub.js";

function mockSocket(send: (callback: (error?: Error) => void) => void): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: (_payload: string, callback: (error?: Error) => void) => send(callback),
    close: vi.fn(),
    terminate: vi.fn(),
  } as unknown as WebSocket;
}

describe("sendToConnectionConfirmed", () => {
  it("只在 ws.send 回调成功后报告投递成功", async () => {
    const ws = mockSocket((callback) => setTimeout(() => callback(), 10));
    registerConnection("confirmed", ws, { connectedAt: "now", lastActiveAt: "now" });
    await expect(sendToConnectionConfirmed("confirmed", "reply", 1024, 100)).resolves.toBe(true);
    unregisterConnection("confirmed");
  });

  it("写出回调失败时终止连接并向业务层报告失败", async () => {
    const ws = mockSocket((callback) => callback(new Error("socket failed")));
    registerConnection("failed", ws, { connectedAt: "now", lastActiveAt: "now" });
    await expect(sendToConnectionConfirmed("failed", "reply", 1024, 100)).resolves.toBe(false);
    expect(ws.terminate).toHaveBeenCalledOnce();
    unregisterConnection("failed");
  });

  it("写出回调永久不返回时按配置超时失败", async () => {
    const ws = mockSocket(() => undefined);
    registerConnection("timeout", ws, { connectedAt: "now", lastActiveAt: "now" });
    await expect(sendToConnectionConfirmed("timeout", "reply", 1024, 20)).resolves.toBe(false);
    expect(ws.terminate).toHaveBeenCalledOnce();
    unregisterConnection("timeout");
  });
});
