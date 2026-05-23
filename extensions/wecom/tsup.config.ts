import { defineConfig } from "tsup";

/**
 * WeCom plugin — bundle runtime deps; OpenClaw stays external.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  target: "node22",
  outDir: "dist",
  external: [/^openclaw(\/.*)?$/],
  noExternal: [
    "@partme.ai/openclaw-message-sdk",
    "@wecom/aibot-node-sdk",
    "fast-xml-parser",
    "file-type",
    "undici",
    "zod",
  ],
});
