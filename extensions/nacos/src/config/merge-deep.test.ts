import { describe, expect, it } from "vitest";
import { deepMerge } from "./merge-deep.js";

describe("deepMerge", () => {
  it("merges nested objects", () => {
    const base = { a: 1, b: { x: 1 } };
    const next = { b: { y: 2 }, c: 3 };
    expect(deepMerge(base, next)).toEqual({ a: 1, b: { x: 1, y: 2 }, c: 3 });
  });

  it("replaces arrays from source", () => {
    expect(deepMerge({ list: [1, 2] } as Record<string, unknown>, { list: [3] })).toEqual({
      list: [3],
    });
  });

  it("skips undefined values in source", () => {
    expect(deepMerge({ a: 1 }, { a: undefined, b: 2 })).toEqual({ a: 1, b: 2 });
  });
});
