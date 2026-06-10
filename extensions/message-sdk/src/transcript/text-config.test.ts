import { describe, expect, it } from "vitest";
import { resolveChannelUserTexts } from "./text-config.js";

describe("resolveChannelUserTexts", () => {
  const defaults = { thinking: "default", tool: "tool-default" };
  const mapping = { thinking: "thinkingText", tool: "toolStatusText" };

  it("returns defaults when no overrides", () => {
    expect(resolveChannelUserTexts(defaults, mapping, {})).toEqual(defaults);
  });

  it("applies flat *Text overrides", () => {
    expect(
      resolveChannelUserTexts(defaults, mapping, { thinkingText: "flat" }),
    ).toEqual({ thinking: "flat", tool: "tool-default" });
  });

  it("ignores blank flat values", () => {
    expect(
      resolveChannelUserTexts(defaults, mapping, { thinkingText: "   " }),
    ).toEqual(defaults);
  });
});
