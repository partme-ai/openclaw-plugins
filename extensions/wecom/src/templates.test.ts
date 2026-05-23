import { describe, expect, it } from "vitest";
import {
  buildAgentReplyTimeoutSummary,
  buildDispatchErrorSummary,
  buildMediaErrorSummary,
  formatWecomTemplate,
  resolveWecomTemplates,
  resolveWecomToolStatusLine,
  WECOM_DEFAULT_TEMPLATES,
} from "./templates.js";
import type { WeComConfig } from "./utils.js";

describe("resolveWecomTemplates", () => {
  it("returns defaults when no overrides", () => {
    expect(resolveWecomTemplates({} as WeComConfig).thinking).toBe(
      WECOM_DEFAULT_TEMPLATES.thinking,
    );
  });

  it("merges account-level template overrides", () => {
    const resolved = resolveWecomTemplates({
      templates: { thinking: "自定义思考…", compaction: "压缩中…" },
    } as WeComConfig);
    expect(resolved.thinking).toBe("自定义思考…");
    expect(resolved.compaction).toBe("压缩中…");
    expect(resolved.generating).toBe(WECOM_DEFAULT_TEMPLATES.generating);
  });

  it("ignores blank overrides", () => {
    const resolved = resolveWecomTemplates({
      templates: { thinking: "   " },
    } as WeComConfig);
    expect(resolved.thinking).toBe(WECOM_DEFAULT_TEMPLATES.thinking);
  });
});

describe("formatWecomTemplate", () => {
  it("substitutes known placeholders", () => {
    expect(formatWecomTemplate("⏱ {elapsed}s · 已完成", { elapsed: 12 })).toBe(
      "⏱ 12s · 已完成",
    );
  });

  it("leaves unknown placeholders intact", () => {
    expect(formatWecomTemplate("tool={toolName}", {})).toBe("tool={toolName}");
  });
});

describe("resolveWecomToolStatusLine", () => {
  it("uses toolName when template includes placeholder", () => {
    const templates = resolveWecomTemplates({
      templates: { tool: "正在调用 {toolName}…" },
    } as WeComConfig);
    expect(resolveWecomToolStatusLine(templates, "web_search")).toBe("正在调用 web_search…");
  });

  it("falls back to static tool template without placeholder", () => {
    expect(resolveWecomToolStatusLine(WECOM_DEFAULT_TEMPLATES, "web_search")).toBe(
      WECOM_DEFAULT_TEMPLATES.tool,
    );
  });
});

describe("buildAgentReplyTimeoutSummary", () => {
  it("uses custom timeout template", () => {
    const templates = resolveWecomTemplates({
      templates: { timeout: "超时 {minutes} 分钟" },
    } as WeComConfig);
    expect(buildAgentReplyTimeoutSummary(360_000, templates)).toBe("超时 6 分钟");
  });
});

describe("buildDispatchErrorSummary", () => {
  it("uses custom dispatchError template", () => {
    const templates = resolveWecomTemplates({
      templates: { dispatchError: "[{kind}] {detail}" },
    } as WeComConfig);
    expect(buildDispatchErrorSummary("tool", "boom", templates)).toBe("[tool] boom");
  });
});

describe("buildMediaErrorSummary", () => {
  it("uses reason template for rejectReason", () => {
    const templates = resolveWecomTemplates({
      templates: { mediaErrorReason: "失败：{reason}" },
    } as WeComConfig);
    expect(buildMediaErrorSummary("/tmp/a.png", { rejectReason: "过大" }, templates)).toBe(
      "失败：过大",
    );
  });
});
