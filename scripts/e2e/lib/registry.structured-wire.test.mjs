import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePlugins } from "./registry.mjs";

test("O3 exception requires an exact plugin set and explicit fixture opt-in", () => {
  const previous = process.env.OPENCLAW_E2E_STRUCTURED_WIRE;
  try {
    delete process.env.OPENCLAW_E2E_STRUCTURED_WIRE;
    assert.throws(() => resolvePlugins(["mqtt", "router", "wecom", "gotify"]), /alone/);
    process.env.OPENCLAW_E2E_STRUCTURED_WIRE = "1";
    assert.deepEqual(resolvePlugins(["wecom", "router", "mqtt", "gotify"]), ["wecom", "router", "mqtt", "gotify"]);
    assert.throws(() => resolvePlugins(["mqtt", "wecom"]), /alone/);
    assert.throws(() => resolvePlugins(["mqtt", "router", "wecom", "gotify", "memory"]), /alone/);
    assert.throws(() => resolvePlugins(["mqtt", "mqtt", "router", "wecom"]), /alone/);
    assert.ok(!resolvePlugins().includes("wecom"));
    assert.deepEqual(resolvePlugins(["wecom"]), ["wecom"]);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_E2E_STRUCTURED_WIRE;
    else process.env.OPENCLAW_E2E_STRUCTURED_WIRE = previous;
  }
});
