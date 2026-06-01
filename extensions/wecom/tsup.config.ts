import { defineConfig } from "tsup";

/**
 * WeCom plugin — bundle runtime deps; OpenClaw stays external.
 * undici/file-type/aibot-node-sdk 移出 noExternal：其 CJS 内部使用 require("assert")
 * 在 ESM bundle 中会触发 "Dynamic require of assert is not supported" 错误。
 */
export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  target: "node22",
  outDir: "dist",
  external: [/^openclaw(\/.*)?$/, "undici", "file-type", "@wecom/aibot-node-sdk"],
  noExternal: [
    "@partme.ai/openclaw-message-sdk",
    "fast-xml-parser",
    "zod",
  ],
});
