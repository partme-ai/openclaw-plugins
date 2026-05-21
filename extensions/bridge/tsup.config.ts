import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  platform: "node",
  splitting: false,
  sourcemap: true,
  treeshake: true,
  external: ["openclaw"],
});
