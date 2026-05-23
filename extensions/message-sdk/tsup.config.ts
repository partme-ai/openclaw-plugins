import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/bridge/index.ts"],
  format: ["esm"],
  target: "es2022",
  dts: { resolve: false },
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  outDir: "dist",
});
