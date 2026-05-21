/**
 * xml-parser 单元测试 — Agent 模式 XML 解析
 */
import { describe, it, expect } from "vitest";
import {
  parseXml,
  extractMsgType,
  extractFromUser,
  extractToUser,
  extractContent,
  extractMediaId,
  extractMsgId,
  extractFileName,
  extractChatId,
  extractAgentId,
} from "./xml-parser.js";

// ============================================================================
// parseXml
// ============================================================================

describe("parseXml", () => {
  it("解析基本 XML 消息", () => {
    const xml = `<xml>
      <ToUserName><![CDATA[corp123]]></ToUserName>
      <FromUserName><![CDATA[user456]]></FromUserName>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[你好]]></Content>
      <MsgId>789</MsgId>
    </xml>`;
    const msg = parseXml(xml);
    expect(msg.ToUserName).toBe("corp123");
    expect(msg.FromUserName).toBe("user456");
    expect(msg.MsgType).toBe("text");
    expect(msg.Content).toBe("你好");
  });

  it("解析空 XML", () => {
    const msg = parseXml("<xml></xml>");
    expect(msg).toBeDefined();
  });
});

// ============================================================================
// extractMsgType
// ============================================================================

describe("extractMsgType", () => {
  it("提取并小写化", () => {
    expect(extractMsgType({ MsgType: "TEXT" })).toBe("text");
    expect(extractMsgType({ MsgType: "Image" })).toBe("image");
  });

  it("缺失字段返回空字符串", () => {
    expect(extractMsgType({})).toBe("");
  });
});

// ============================================================================
// extractFromUser / extractToUser
// ============================================================================

describe("extractFromUser / extractToUser", () => {
  it("提取发送者和接收者", () => {
    const msg = { FromUserName: "sender1", ToUserName: "receiver1" };
    expect(extractFromUser(msg)).toBe("sender1");
    expect(extractToUser(msg)).toBe("receiver1");
  });

  it("缺失返回空字符串", () => {
    expect(extractFromUser({})).toBe("");
    expect(extractToUser({})).toBe("");
  });
});

// ============================================================================
// extractContent
// ============================================================================

describe("extractContent", () => {
  it("text 消息提取内容", () => {
    expect(extractContent({ MsgType: "text", Content: "你好世界" })).toBe("你好世界");
  });

  it("text 内容为数字", () => {
    expect(extractContent({ MsgType: "text", Content: 123 })).toBe("123");
  });

  it("voice 消息提取识别结果", () => {
    expect(extractContent({ MsgType: "voice", Recognition: "转文字结果" })).toBe("转文字结果");
  });

  it("voice 无识别结果返回占位符", () => {
    expect(extractContent({ MsgType: "voice" })).toBe("[语音消息]");
  });

  it("image 消息返回图片 URL", () => {
    expect(extractContent({ MsgType: "image", PicUrl: "https://img.com/p.jpg" }))
      .toBe("[图片] https://img.com/p.jpg");
  });

  it("file 消息返回占位符", () => {
    expect(extractContent({ MsgType: "file" })).toBe("[文件消息]");
  });

  it("video 消息返回占位符", () => {
    expect(extractContent({ MsgType: "video" })).toBe("[视频消息]");
  });

  it("location 消息", () => {
    expect(extractContent({
      MsgType: "location",
      Label: "公司",
      Location_X: "39.9",
      Location_Y: "116.3",
    })).toContain("[位置] 公司 (39.9, 116.3)");
  });

  it("link 消息", () => {
    expect(extractContent({
      MsgType: "link",
      Title: "标题",
      Description: "描述",
      Url: "https://example.com",
    })).toContain("[链接] 标题");
    expect(extractContent({
      MsgType: "link",
      Title: "标题",
      Description: "描述",
      Url: "https://example.com",
    })).toContain("描述");
    expect(extractContent({
      MsgType: "link",
      Title: "标题",
      Description: "描述",
      Url: "https://example.com",
    })).toContain("https://example.com");
  });

  it("event 消息", () => {
    expect(extractContent({
      MsgType: "event",
      Event: "subscribe",
      EventKey: "key123",
    })).toBe("[事件] subscribe - key123");
  });

  it("未知类型返回占位符", () => {
    expect(extractContent({ MsgType: "unknown_type" })).toBe("[unknown_type]");
    expect(extractContent({})).toBe("[未知消息类型]");
  });

  it("Content 为 fast-xml-parser #text 格式", () => {
    expect(extractContent({
      MsgType: "text",
      Content: { "#text": "嵌套文本" },
    })).toBe("嵌套文本");
  });

  it("Content 为数组（多条消息）", () => {
    const result = extractContent({
      MsgType: "text",
      Content: ["第一行", "第二行"],
    });
    expect(result).toContain("第一行");
    expect(result).toContain("第二行");
  });
});

// ============================================================================
// extractMediaId
// ============================================================================

describe("extractMediaId", () => {
  it("提取 MediaId", () => {
    expect(extractMediaId({ MediaId: "media-123" })).toBe("media-123");
  });

  it("兼容 MediaID 大写", () => {
    expect(extractMediaId({ MediaID: "media-456" })).toBe("media-456");
  });

  it("兼容 mediaid 小写", () => {
    expect(extractMediaId({ mediaid: "media-789" })).toBe("media-789");
  });

  it("数字类型 MediaId", () => {
    expect(extractMediaId({ MediaId: 12345 })).toBe("12345");
  });

  it("缺失返回 undefined", () => {
    expect(extractMediaId({})).toBeUndefined();
  });

  it("MediaId 为 #text 嵌套对象", () => {
    expect(extractMediaId({ MediaId: { "#text": "nested-id" } })).toBe("nested-id");
  });
});

// ============================================================================
// extractMsgId
// ============================================================================

describe("extractMsgId", () => {
  it("提取 MsgId", () => {
    expect(extractMsgId({ MsgId: "msg-001" })).toBe("msg-001");
  });

  it("兼容 MsgID 大写", () => {
    expect(extractMsgId({ MsgID: "MSG-002" })).toBe("MSG-002");
  });

  it("兼容 msgid 小写", () => {
    expect(extractMsgId({ msgid: "msg003" })).toBe("msg003");
  });

  it("缺失返回 undefined", () => {
    expect(extractMsgId({})).toBeUndefined();
  });
});

// ============================================================================
// extractFileName
// ============================================================================

describe("extractFileName", () => {
  it("提取 FileName", () => {
    expect(extractFileName({ FileName: "report.pdf" })).toBe("report.pdf");
  });

  it("兼容多种大小写", () => {
    expect(extractFileName({ Filename: "data.csv" })).toBe("data.csv");
    expect(extractFileName({ filename: "doc.txt" })).toBe("doc.txt");
    expect(extractFileName({ fileName: "img.png" })).toBe("img.png");
  });

  it("缺失返回 undefined", () => {
    expect(extractFileName({})).toBeUndefined();
  });

  it("空白字符串返回 undefined", () => {
    expect(extractFileName({ FileName: "   " })).toBeUndefined();
  });

  it("#text 嵌套对象格式", () => {
    expect(extractFileName({ FileName: { "#text": "nested-file.pdf" } })).toBe("nested-file.pdf");
  });
});

// ============================================================================
// extractChatId / extractAgentId
// ============================================================================

describe("extractChatId", () => {
  it("提取群聊 ID", () => {
    expect(extractChatId({ ChatId: "group-123" })).toBe("group-123");
  });

  it("缺失返回 undefined", () => {
    expect(extractChatId({})).toBeUndefined();
  });
});

describe("extractAgentId", () => {
  it("提取 AgentID", () => {
    expect(extractAgentId({ AgentID: "agent-1" })).toBe("agent-1");
  });

  it("兼容 AgentId 驼峰", () => {
    expect(extractAgentId({ AgentId: "agent-2" })).toBe("agent-2");
    expect(extractAgentId({ agentid: 1000001 })).toBe(1000001);
  });

  it("缺失返回 undefined", () => {
    expect(extractAgentId({})).toBeUndefined();
  });
});
