import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPackedSdkImports } from "./packed-sdk-imports.mjs";

test("checks SDK imports in emitted chunks against typed public host exports", () => {
  const exports = {
    "./plugin-sdk/channel-outbound": { types: "./out.d.ts", default: "./out.js" },
    "./plugin-sdk/internal": { default: "./private.js" },
  };
  const source = [
    'import { setup } from "openclaw/plugin-sdk/channel-outbound";',
    'export { reply } from "openclaw/plugin-sdk/channel-message";',
    'const lazy = () => import("openclaw/plugin-sdk/channel-streaming");',
    'require("openclaw/plugin-sdk/text-runtime");',
    'require("openclaw/plugin-sdk/internal");',
    '// import "openclaw/plugin-sdk/comment";',
  ].join("\n");
  assert.deepEqual(checkPackedSdkImports("chunk.js", source, exports), [
    "openclaw/plugin-sdk/channel-message", "openclaw/plugin-sdk/channel-streaming",
    "openclaw/plugin-sdk/internal", "openclaw/plugin-sdk/text-runtime",
  ]);
});
