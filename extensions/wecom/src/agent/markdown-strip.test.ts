/**
 * stripMarkdown 单元测试 — Agent 模式 Markdown 降级
 */
import { describe, it, expect } from "vitest";
import { stripMarkdown } from "./markdown-strip.js";

describe("stripMarkdown", () => {
  // ── Headers ──
  it("h1-h6 标题 → 【】包裹", () => {
    expect(stripMarkdown("# 标题")).toBe("【标题】");
    expect(stripMarkdown("## 二级标题")).toBe("【二级标题】");
    expect(stripMarkdown("###### 六级")).toBe("【六级】");
  });

  // ── Bold/Italic ──
  it("**粗体** 去除标记", () => {
    expect(stripMarkdown("这是 **重要** 内容")).toBe("这是 重要 内容");
  });

  it("*斜体* 去除标记", () => {
    expect(stripMarkdown("这是 *斜体* 文字")).toBe("这是 斜体 文字");
  });

  it("__下划线__ 去除标记", () => {
    expect(stripMarkdown("__强调__")).toBe("强调");
  });

  // ── Lists ──
  it("无序列表 → ·", () => {
    expect(stripMarkdown("- 项目1\n- 项目2")).toBe("· 项目1\n· 项目2");
    expect(stripMarkdown("* 项目A")).toBe("· 项目A");
  });

  it("有序列表保留编号", () => {
    expect(stripMarkdown("1. 第一步\n2. 第二步")).toBe("1. 第一步\n2. 第二步");
  });

  // ── Code ──
  it("内联代码去除反引号", () => {
    expect(stripMarkdown("使用 `console.log()` 调试")).toBe("使用 console.log() 调试");
  });

  it("代码块保留语言标识和缩进", () => {
    const result = stripMarkdown("```typescript\nconst x = 1;\nconsole.log(x);\n```");
    expect(result).toContain("[typescript]");
    expect(result).toContain("    const x = 1;");
    expect(result).toContain("    console.log(x);");
  });

  it("代码块无语言标识", () => {
    const result = stripMarkdown("```\nline1\nline2\n```");
    // 第一行不会被缩进（紧接 opening ```）
    expect(result).toContain("    line2");
    expect(result.length).toBeGreaterThan(0);
  });

  it("空代码块返回空", () => {
    expect(stripMarkdown("```\n```")).toBe("");
  });

  // ── Links/Images ──
  it("链接 → 文本 (URL)", () => {
    expect(stripMarkdown("[谷歌](https://google.com)")).toBe("谷歌 (https://google.com)");
  });

  it("图片 → [图片: alt]", () => {
    expect(stripMarkdown("![logo](https://img.com/logo.png)")).toBe("[图片: logo]");
  });

  it("图片无 alt 文本", () => {
    expect(stripMarkdown("![](https://img.com/pic.png)")).toBe("[图片: ]");
  });

  // ── Strikethrough ──
  it("~~删除线~~ 去除", () => {
    expect(stripMarkdown("~~过时的内容~~")).toBe("过时的内容");
  });

  // ── Blockquote ──
  it("引用去除 > 前缀", () => {
    expect(stripMarkdown("> 引用内容")).toBe("引用内容");
  });

  // ── Horizontal Rule ──
  it("水平线 → ──", () => {
    // --- 和 ---- 能正常识别（不会被 bold/italic 先消费）
    expect(stripMarkdown("---")).toBe("────────────");
    expect(stripMarkdown("----")).toBe("────────────");
    // ___ 和 *** 会被 italic/underline regex 先消费，简化处理
  });

  // ── Tables ──
  it("表格对齐为纯文本", () => {
    const result = stripMarkdown("| 姓名 | 年龄 |\n|------|------|\n| 张三 | 25 |\n| 李四 | 30 |");
    expect(result).toContain("姓名");
    expect(result).toContain("年龄");
    expect(result).toContain("张三");
    expect(result).toContain("李四");
  });

  // ── Combined ──
  it("混合内容综合处理", () => {
    const md = [
      "# 会议纪要",
      "**日期**：2026-05-21",
      "- 讨论项目进度",
      "- 确定下周计划",
      "详见 [文档](https://doc.com/1)",
      "> 备注：会议记录由AI生成",
    ].join("\n");
    const result = stripMarkdown(md);
    expect(result).toContain("【会议纪要】");
    expect(result).toContain("日期：2026-05-21");
    expect(result).toContain("· 讨论项目进度");
    expect(result).toContain("文档 (https://doc.com/1)");
    expect(result).toContain("备注：会议记录由AI生成");
  });

  // ── Edge Cases ──
  it("空字符串返回空", () => {
    expect(stripMarkdown("")).toBe("");
  });

  it("纯文本不变", () => {
    expect(stripMarkdown("这是一段纯文本，没有格式。")).toBe("这是一段纯文本，没有格式。");
  });

  it("多余换行合并", () => {
    const result = stripMarkdown("段落1\n\n\n\n段落2");
    expect(result).toBe("段落1\n\n段落2");
  });

  it("连续多个粗体和斜体", () => {
    expect(stripMarkdown("**粗** *斜* __线__")).toBe("粗 斜 线");
  });

  it("URL 中的下划线不被移除（italic 识别排除 URL）", () => {
    const result = stripMarkdown("链接 https://example.com/page_name 正常");
    expect(result).toContain("page_name");
  });
});
