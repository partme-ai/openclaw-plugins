/**
 * message-converter 单元测试
 * 验证微信消息 ↔ Agent 文本的转换逻辑
 */

import { describe, it, expect } from "vitest";
import { inboundToText, outboundFromText, extractXmlField } from "../src/dispatch/message-converter.js";
import { WxMsgType } from "../src/types.js";
import type { WxMessagePayload, SendMessageRequest } from "../src/types.js";

/** 构造测试消息的辅助函数 */
function makeMsg(overrides: Partial<WxMessagePayload>): WxMessagePayload {
  return {
    msgId: "msg-001",
    fromWxid: "wxid_sender",
    toWxid: "wxid_receiver",
    msgType: WxMsgType.Text,
    createTime: Math.floor(Date.now() / 1000),
    isGroup: false,
    isSelf: false,
    ...overrides,
  };
}

describe("inboundToText", () => {
  it("文本消息应返回 content", () => {
    const result = inboundToText(makeMsg({ content: "你好" }));
    expect(result).toBe("你好");
  });

  it("空文本消息应返回 null", () => {
    const result = inboundToText(makeMsg({ content: undefined }));
    expect(result).toBeNull();
  });

  it("群消息应去除发送者前缀", () => {
    const result = inboundToText(
      makeMsg({
        isGroup: true,
        groupSenderWxid: "wxid_speaker",
        content: "wxid_speaker:\n大家好",
      })
    );
    expect(result).toBe("大家好");
  });

  it("群消息如无前缀应直接返回", () => {
    const result = inboundToText(
      makeMsg({
        isGroup: true,
        groupSenderWxid: "wxid_speaker",
        content: "没有前缀的消息",
      })
    );
    expect(result).toBe("没有前缀的消息");
  });

  it("图片消息应返回 [图片消息] 标记", () => {
    const result = inboundToText(makeMsg({ msgType: WxMsgType.Image }));
    expect(result).toContain("[图片消息]");
  });

  it("语音消息应返回 [语音消息]", () => {
    const result = inboundToText(makeMsg({ msgType: WxMsgType.Voice }));
    expect(result).toContain("[语音消息]");
  });

  it("链接消息应提取标题和 URL", () => {
    const xml = '<msg><appmsg><title>测试文章</title><des>描述</des><url>https://example.com</url></appmsg></msg>';
    const result = inboundToText(
      makeMsg({ msgType: WxMsgType.Link, rawXml: xml })
    );
    expect(result).toContain("测试文章");
    expect(result).toContain("https://example.com");
  });

  it("名片消息应提取昵称", () => {
    const xml = '<msg nickname="张三" alias="zhangsan" />';
    const result = inboundToText(
      makeMsg({ msgType: WxMsgType.Card, rawXml: xml })
    );
    expect(result).toContain("张三");
    expect(result).toContain("zhangsan");
  });

  it("系统消息应返回 null（不处理）", () => {
    expect(inboundToText(makeMsg({ msgType: WxMsgType.System }))).toBeNull();
    expect(inboundToText(makeMsg({ msgType: WxMsgType.SystemExtend }))).toBeNull();
  });

  it("位置消息应提取地名", () => {
    const xml = '<location label="北京天安门" x="39.90" y="116.39" />';
    const result = inboundToText(
      makeMsg({ msgType: WxMsgType.Location, rawXml: xml })
    );
    expect(result).toContain("北京天安门");
  });

  it("小程序消息应提取标题", () => {
    const xml = '<msg><appmsg><title>打卡小程序</title><sourcedisplayname>PartMe</sourcedisplayname></appmsg></msg>';
    const result = inboundToText(
      makeMsg({ msgType: WxMsgType.MiniApp, rawXml: xml })
    );
    expect(result).toContain("打卡小程序");
    expect(result).toContain("PartMe");
  });

  it("表情消息应返回标记", () => {
    const result = inboundToText(makeMsg({ msgType: WxMsgType.Emoji }));
    expect(result).toBe("[表情消息]");
  });

  it("视频消息应返回标记", () => {
    const result = inboundToText(makeMsg({ msgType: WxMsgType.Video }));
    expect(result).toBe("[视频消息]");
  });

  it("未知类型应回退到 content 或类型码", () => {
    expect(inboundToText(makeMsg({ msgType: 999 as WxMsgType, content: "raw" }))).toBe("raw");
    expect(inboundToText(makeMsg({ msgType: 999 as WxMsgType }))).toContain("999");
  });
});

describe("outboundFromText", () => {
  it("应生成文本发送请求", () => {
    const req: SendMessageRequest = outboundFromText("wxid_target", "你好呀");
    expect(req.toWxid).toBe("wxid_target");
    expect(req.msgType).toBe("text");
    expect(req.content).toBe("你好呀");
  });
});

describe("extractXmlField", () => {
  it("应匹配属性模式", () => {
    expect(extractXmlField('label="天安门"', "label")).toBe("天安门");
  });

  it("应匹配标签模式", () => {
    expect(extractXmlField("<title>测试</title>", "title")).toBe("测试");
  });

  it("应匹配 CDATA 模式", () => {
    const xml = "<content><![CDATA[Hello World]]></content>";
    expect(extractXmlField(xml, "content")).toBe("Hello World");
  });

  it("找不到时返回 null", () => {
    expect(extractXmlField("<foo>bar</foo>", "baz")).toBeNull();
  });
});
