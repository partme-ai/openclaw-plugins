import { describe, expect, it } from "vitest";

import { extractInboundTextContent } from "./bot.js";

describe("extractInboundTextContent（多模态消息提取）", () => {
  it("text 消息应返回文本内容", () => {
    expect(
      extractInboundTextContent({ origin: 3, msgtype: "text", text: { content: "你好" } }),
    ).toBe("你好");
  });

  it("image 消息应返回 media_id 占位", () => {
    expect(
      extractInboundTextContent({ origin: 3, msgtype: "image", image: { media_id: "img-001" } }),
    ).toBe("[图片] media_id=img-001");
  });

  it("非 origin=3 应返回 undefined", () => {
    expect(
      extractInboundTextContent({ origin: 4, msgtype: "text", text: { content: "x" } }),
    ).toBeUndefined();
  });
});
