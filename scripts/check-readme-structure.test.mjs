import assert from "node:assert/strict";
import test from "node:test";

import { checkReadmeStructure } from "./check-readme-structure.mjs";

test("28 个组件的双语 README 遵循统一结构", () => {
  const result = checkReadmeStructure();
  assert.equal(result.components, 28);
  assert.equal(result.readmes, 56);
  assert.deepEqual(result.failures, []);
});

