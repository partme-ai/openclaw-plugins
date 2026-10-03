import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
  outDir: "dist",
  banner: { js: 'import { createRequire as createDouyinRequire } from "node:module"; const require = createDouyinRequire(import.meta.url);' },
  external: [/^openclaw(\/.*)?$/],
  noExternal: ["@partme.ai/openclaw-message-sdk"],
});
