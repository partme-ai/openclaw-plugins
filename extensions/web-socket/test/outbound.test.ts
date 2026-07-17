import { afterEach, describe, expect, it } from "vitest";

import { webSocketOutbound } from "../src/outbound.js";
import { clearSessionMappings } from "../src/routing/session-mapper.js";

afterEach(() => clearSessionMappings());

describe("WebSocket ChannelOutboundAdapter 失败语义", () => {
  it("找不到 session 连接时抛错，避免上层把占位 messageId 当作投递成功", async () => {
    await expect(webSocketOutbound.sendText({
      to: "agent:main:web-socket:offline",
      text: "must not be silently dropped",
    } as never)).rejects.toThrow("no connection");
  });
});
