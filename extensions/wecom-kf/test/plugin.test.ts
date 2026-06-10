import { describe, expect, it } from "vitest";
import plugin from "../src/index.js";

describe("wecom-kf plugin entry", () => {
  it("exports wecom-kf plugin id", () => {
    expect(plugin.id).toBe("wecom-kf");
  });
});
