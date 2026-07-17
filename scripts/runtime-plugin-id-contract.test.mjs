import assert from "node:assert/strict";
import test from "node:test";

import { checkRuntimePluginIds } from "./runtime-plugin-id-contract.mjs";

test("所有运行时插件 ID 与 manifest ID 一致", () => {
  const result = checkRuntimePluginIds();
  assert.equal(result.checked, 27);
  assert.deepEqual(result.failures, []);
});

