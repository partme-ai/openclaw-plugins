import { describe, expect, it } from "vitest";
import { formatTimestampYyyyMMddHHmmss } from "./format-timestamp.js";

describe("formatTimestampYyyyMMddHHmmss", () => {
  it("formats fixed date as 14 digits", () => {
    const d = new Date(2026, 3, 14, 15, 30, 45);
    expect(formatTimestampYyyyMMddHHmmss(d)).toBe("20260414153045");
  });

  it("pads single-digit month/day/hour/minute/second", () => {
    const d = new Date(2026, 0, 5, 8, 9, 1);
    expect(formatTimestampYyyyMMddHHmmss(d)).toBe("20260105080901");
  });
});
