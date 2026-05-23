/**
 * parse-directives.test.ts — 媒体路径、指令、下载、读取与出站解析工具。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, expect, it } from "vitest";
import { expandHomePath, parseMediaDirectives } from "./parse-directives.js";

describe("parse-directives", () => {
  it("extracts MEDIA paths and strips lines", () => {
    const r = parseMediaDirectives("hello\nMEDIA: `/tmp/a.png`\n\nworld");
    expect(r.paths).toEqual(["/tmp/a.png"]);
    expect(r.text).toBe("hello\n\nworld");
  });

  it("expands tilde paths", () => {
    expect(expandHomePath("~/x", "/home/u")).toBe("/home/u/x");
  });
});
