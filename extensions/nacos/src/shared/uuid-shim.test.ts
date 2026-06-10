/**
 * Verifies uuid/v4 shim resolves when hoisted uuid lacks the ./v4 export.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("uuid-shim", () => {
  it("intercepts require('uuid/v4') after shim load", () => {
    const require = createRequire(import.meta.url);
    require(join(dirname(fileURLToPath(import.meta.url)), "uuid-shim.cjs"));

    const v4 = require("uuid/v4") as () => string;
    const id = v4();

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
