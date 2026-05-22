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
