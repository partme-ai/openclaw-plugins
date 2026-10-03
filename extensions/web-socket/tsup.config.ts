import { defineConfig } from "tsup";

/**
 * openclaw-web-socket tsup 配置
 * noExternal: 将 ws 打包进 dist（OpenClaw 插件安装不执行 npm install）
 */
export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  outDir: "dist",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  external: [/^openclaw(\/.*)?$/],
  noExternal: ["ws"],
});
