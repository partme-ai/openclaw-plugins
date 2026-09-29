import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
  outDir: "dist",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  external: [/^openclaw(\/.*)?$/],
  noExternal: ["@partme.ai/openclaw-message-sdk"],
});
