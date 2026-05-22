import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
  outDir: "dist",
  external: [/^openclaw(\/.*)?$/],
  noExternal: ["@partme.ai/openclaw-message-sdk"],
});
