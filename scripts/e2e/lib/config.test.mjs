import assert from "node:assert/strict";
import { test } from "node:test";

import { fixtureModelSupportsTools } from "./config.mjs";

test("Memory and OpenMem expose tools while unrelated model fixture behavior stays unchanged", () => {
  assert.equal(fixtureModelSupportsTools(["openmem"]), true);
  assert.equal(fixtureModelSupportsTools(["memory"]), true);
  assert.equal(fixtureModelSupportsTools(["amap"]), true);
  assert.equal(fixtureModelSupportsTools(["mqtt"]), false);
});
