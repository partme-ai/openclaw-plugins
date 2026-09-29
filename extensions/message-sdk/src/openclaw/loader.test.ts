import { describe, expect, it } from "vitest";
import { importOpenClawPluginSdk } from "./loader.js";

describe("importOpenClawPluginSdk", () => {
  it("preserves optional loading during tests", async () => {
    await expect(importOpenClawPluginSdk("missing-subpath")).resolves.toBeNull();
  });

  it("returns null for an unavailable public subpath outside test mode", async () => {
    const vitest = process.env.VITEST;
    const nodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    delete process.env.NODE_ENV;
    try {
      await expect(importOpenClawPluginSdk("missing-subpath")).resolves.toBeNull();
    } finally {
      if (vitest !== undefined) process.env.VITEST = vitest;
      if (nodeEnv !== undefined) process.env.NODE_ENV = nodeEnv;
    }
  });
});
