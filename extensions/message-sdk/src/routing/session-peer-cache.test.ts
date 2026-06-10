/**
 * session-peer-cache 单元测试
 */
import { describe, expect, it } from "vitest";
import { createSessionPeerCache } from "./session-peer-cache.js";

describe("createSessionPeerCache", () => {
  it("set + get 往返", () => {
    const cache = createSessionPeerCache();
    cache.set("session:1", { chatId: "ChatId", chatType: "group" });
    expect(cache.get("session:1")).toEqual({ chatId: "ChatId", chatType: "group" });
  });

  it("undefined sessionKey 返回 undefined", () => {
    const cache = createSessionPeerCache();
    expect(cache.get(undefined)).toBeUndefined();
  });
});
