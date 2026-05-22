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
