/**
 * template-card-parser 单元测试 — 类型修正 + 卡片提取 + 流式遮罩
 */
import { describe, it, expect } from "vitest";
import { extractTemplateCards, maskTemplateCardBlocks } from "./template-card-parser.js";
import type { ExtractedTemplateCard } from "./interface.js";

// ============================================================================
// extractTemplateCards
// ============================================================================

describe("extractTemplateCards", () => {
  it("提取 text_notice 卡片", () => {
    const text = '这是回复\n```json\n{"card_type":"text_notice","main_title":{"title":"通知","desc":"内容"}}\n```\n结束';
    const result = extractTemplateCards(text);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].cardType).toBe("text_notice");
    const card = result.cards[0].cardJson;
    expect(card.main_title).toBeDefined();
    expect(card.task_id).toBeDefined(); // 自动补全
    expect(result.remainingText).not.toContain("```json");
  });

  it("提取 button_interaction 卡片", () => {
    const text = '```json\n{"card_type":"button_interaction","main_title":{"title":"确认"},"button_list":[{"text":"是","key":"yes"}]}\n```';
    const result = extractTemplateCards(text);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].cardType).toBe("button_interaction");
    expect(result.remainingText).toBe("");
  });

  it("vote_interaction 简化格式自动转换", () => {
    const text = '```json\n{"card_type":"vote_interaction","title":"投票标题","options":[{"id":"a","text":"选项A"},{"id":"b","text":"选项B"}]}\n```';
    const result = extractTemplateCards(text);
    expect(result.cards).toHaveLength(1);
    const card = result.cards[0].cardJson;
    // 简化格式已转换为 API 格式
    expect(card.checkbox).toBeDefined();
    const cb = card.checkbox as Record<string, unknown>;
    expect(cb.option_list).toBeDefined();
    expect(Array.isArray(cb.option_list)).toBe(true);
    expect(card.submit_button).toBeDefined();
    expect(card.main_title).toBeDefined();
    // 简化字段已删除
    expect(card.options).toBeUndefined();
    expect(card.title).toBeUndefined();
  });

  it("multiple_interaction 简化格式自动转换", () => {
    const text = '```json\n{"card_type":"multiple_interaction","title":"多选","selectors":[{"title":"问题1","options":[{"id":"x","text":"选项X"}]}]}\n```';
    const result = extractTemplateCards(text);
    expect(result.cards).toHaveLength(1);
    const card = result.cards[0].cardJson;
    expect(card.select_list).toBeDefined();
    expect(card.submit_button).toBeDefined();
    expect(card.selectors).toBeUndefined();
  });

  it("vote_interaction 已是API格式则跳过转换", () => {
    const text = '```json\n{"card_type":"vote_interaction","checkbox":{"question_key":"q1","option_list":[{"id":"a","text":"A"}]},"submit_button":{"text":"提交","key":"k1"}}\n```';
    const result = extractTemplateCards(text);
    expect(result.cards).toHaveLength(1);
    // checkbox 保持原样
    expect((result.cards[0].cardJson.checkbox as any).question_key).toBe("q1");
  });

  it("非法 card_type 不提取", () => {
    const text = '```json\n{"card_type":"invalid_type","data":"x"}\n```';
    const result = extractTemplateCards(text);
    expect(result.cards).toHaveLength(0);
    expect(result.remainingText).toContain("invalid_type");
  });

  it("非 JSON 代码块保留在文本中", () => {
    const text = '```json\n{invalid json content\n```';
    const result = extractTemplateCards(text);
    expect(result.cards).toHaveLength(0);
  });

  it("无代码块的纯文本原样返回", () => {
    const text = "这是普通回复，不含卡片。";
    const result = extractTemplateCards(text);
    expect(result.cards).toHaveLength(0);
    expect(result.remainingText).toBe("这是普通回复，不含卡片。");
  });

  it("多张卡片同时提取", () => {
    const text = [
      '```json\n{"card_type":"text_notice","main_title":{"title":"通知1"}}\n```',
      "中间文本",
      '```json\n{"card_type":"news_notice","main_title":{"title":"新闻"}}\n```',
    ].join("\n");
    const result = extractTemplateCards(text);
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0].cardType).toBe("text_notice");
    expect(result.cards[1].cardType).toBe("news_notice");
    expect(result.remainingText).toContain("中间文本");
  });

  it("所有 5 种合法 card_type", () => {
    for (const ct of ["text_notice", "news_notice", "button_interaction", "vote_interaction", "multiple_interaction"]) {
      const text = `\`\`\`json\n{"card_type":"${ct}","main_title":{"title":"t"}}\n\`\`\``;
      const result = extractTemplateCards(text);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].cardType).toBe(ct);
    }
  });

  // ── 类型修正 ──
  it("checkbox.mode 字符串修正为整数", () => {
    const text = '```json\n{"card_type":"vote_interaction","checkbox":{"mode":"single","option_list":[{"id":"a","text":"A"}]}}\n```';
    const result = extractTemplateCards(text);
    const mode = (result.cards[0].cardJson.checkbox as any).mode;
    expect(mode).toBe(0); // "single" → 0
  });

  it("checkbox.mode \"multi\" → 1", () => {
    const text = '```json\n{"card_type":"vote_interaction","checkbox":{"mode":"multi","option_list":[{"id":"a","text":"A"}]}}\n```';
    const result = extractTemplateCards(text);
    expect((result.cards[0].cardJson.checkbox as any).mode).toBe(1);
  });

  it("checkbox.mode 中文别名", () => {
    const cases = [
      { input: '"单选"', expected: 0 },
      { input: '"多选"', expected: 1 },
    ];
    for (const c of cases) {
      const text = `\`\`\`json\n{"card_type":"vote_interaction","checkbox":{"mode":${c.input},"option_list":[{"id":"a","text":"A"}]}}\n\`\`\``;
      const result = extractTemplateCards(text);
      expect((result.cards[0].cardJson.checkbox as any).mode).toBe(c.expected);
    }
  });

  it("source.desc_color 字符串转整数", () => {
    const text = '```json\n{"card_type":"news_notice","main_title":{"title":"新闻"},"source":{"desc_color":"3"}}\n```';
    const result = extractTemplateCards(text);
    const c = result.cards[0].cardJson.source as any;
    expect(c.desc_color).toBe(3);
  });
});

// ============================================================================
// maskTemplateCardBlocks
// ============================================================================

describe("maskTemplateCardBlocks", () => {
  it("遮罩已闭合模板卡片代码块", () => {
    const text = '前面内容\n```json\n{"card_type":"text_notice","main_title":{"title":"通知"}}\n```\n后面内容';
    const result = maskTemplateCardBlocks(text);
    expect(result).toContain("📋");
    expect(result).not.toContain("card_type");
    expect(result).toContain("前面内容");
    expect(result).toContain("后面内容");
  });

  it("非模板卡片代码块保持不变", () => {
    const text = '```json\n{"name":"test","value":123}\n```';
    const result = maskTemplateCardBlocks(text);
    expect(result).toContain('"name":"test"');
    expect(result).not.toContain("📋");
  });

  it("未闭合的模板卡片代码块被截断", () => {
    const text = '```json\n{"card_type":"vote_interaction","title":"投票"';
    const result = maskTemplateCardBlocks(text);
    expect(result).toContain("📋");
    expect(result).not.toContain("vote_interaction");
  });

  it("纯文本不变化", () => {
    const text = "这是普通文本，没有代码块。";
    expect(maskTemplateCardBlocks(text)).toBe(text);
  });

  it("空字符串返回空", () => {
    expect(maskTemplateCardBlocks("")).toBe("");
  });
});
