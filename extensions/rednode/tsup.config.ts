import { defineConfig } from "tsup";

/** Rednode 插件发布构建：生成 Node 22 ESM 入口与类型声明。 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  outDir: "dist",
  external: [/^openclaw(\/.*)?$/],
});
