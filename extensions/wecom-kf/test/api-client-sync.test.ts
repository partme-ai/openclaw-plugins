import { describe, expect, it } from "vitest";

import { parseKfSyncMsgResponse } from "../src/agent/api-client.js";

describe("parseKfSyncMsgResponse", () => {
  it("保留成功分页响应和消息字段", () => {
    expect(parseKfSyncMsgResponse({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "cursor-1",
      has_more: 1,
      msg_list: [{ msgid: "msg-1", msgtype: "text", text: { content: "hello" } }],
    })).toEqual({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "cursor-1",
      has_more: 1,
      msg_list: [{ msgid: "msg-1", msgtype: "text", text: { content: "hello" } }],
    });
  });

  it("允许错误响应省略分页字段，交给上层重试策略处理", () => {
    expect(parseKfSyncMsgResponse({ errcode: 50001, errmsg: "temporary" })).toEqual({
      errcode: 50001,
      errmsg: "temporary",
      has_more: 0,
      msg_list: [],
    });
  });

  it("拒绝把缺少 errcode 的 JSON 误判为成功", () => {
    expect(() => parseKfSyncMsgResponse({})).toThrow("errcode");
  });

  it("拒绝不完整的成功分页响应", () => {
    expect(() => parseKfSyncMsgResponse({ errcode: 0, errmsg: "ok", has_more: 0 })).toThrow("msg_list");
    expect(() => parseKfSyncMsgResponse({ errcode: 0, errmsg: "ok", has_more: 2, msg_list: [] })).toThrow("has_more");
    expect(() => parseKfSyncMsgResponse({
      errcode: 0,
      errmsg: "ok",
      has_more: 0,
      msg_list: [{ msgtype: "text" }],
    })).toThrow("msgid");
  });
});
