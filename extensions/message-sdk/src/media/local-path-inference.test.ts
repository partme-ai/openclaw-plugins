/**
 * local-path-inference.test.ts — 媒体路径、指令、下载、读取与出站解析工具。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, expect, it } from "vitest";
import {
  extractLocalFilePathsFromText,
  extractLocalImagePathsFromText,
} from "./local-path-inference.js";

describe("local-path-inference", () => {
  it("extracts local files", () => {
    const paths = extractLocalFilePathsFromText("see /tmp/foo.txt here");
    expect(paths).toContain("/tmp/foo.txt");
  });

  it("extracts images only when present in inbound body", () => {
    const inbound = "attach /home/u/pic.png";
    const out = extractLocalImagePathsFromText({
      text: "send /home/u/pic.png",
      mustAlsoAppearIn: inbound,
    });
    expect(out).toEqual(["/home/u/pic.png"]);
    expect(
      extractLocalImagePathsFromText({
        text: "send /home/u/other.png",
        mustAlsoAppearIn: inbound,
      }),
    ).toEqual([]);
  });
});
