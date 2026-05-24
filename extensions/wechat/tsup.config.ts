import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  outDir: "dist",
  external: [/^openclaw(\/.*)?$/],
});
