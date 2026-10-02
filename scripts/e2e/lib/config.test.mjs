import assert from "node:assert/strict";
import { test } from "node:test";

import { fixtureModelSupportsTools } from "./config.mjs";

test("OpenMem alone exposes tools while unrelated model fixture behavior stays unchanged", () => {
  assert.equal(fixtureModelSupportsTools(["openmem"]), true);
  assert.equal(fixtureModelSupportsTools(["amap"]), true);
  assert.equal(fixtureModelSupportsTools(["mqtt"]), false);
});
