import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlugins } from "./registry.mjs";

test("O6 permits only the installed telemetry fixture group", () => {
  const previous = process.env.OPENCLAW_E2E_O6;
  const ids = ["mqtt", "router", "gotify", "memory", "tracing", "prometheus"];
  try {
    delete process.env.OPENCLAW_E2E_O6;
    assert.throws(() => resolvePlugins(ids), /alone/);
    process.env.OPENCLAW_E2E_O6 = "1";
    assert.deepEqual(resolvePlugins(ids), ids);
    assert.throws(() => resolvePlugins([...ids, "openmem"]), /alone/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_E2E_O6;
    else process.env.OPENCLAW_E2E_O6 = previous;
  }
});
