import { describe, expect, it } from "vitest";
import plugin from "../src/index.js";

describe("wecom plugin entry", () => {
  it("exports wecom channel plugin id", () => {
    expect(plugin.id).toBe("wecom");
  });
});
