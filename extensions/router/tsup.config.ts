import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  noExternal: ["@partme.ai/openclaw-message-sdk"],
  outDir: "dist",
  tsconfig: "tsconfig.json",
});
