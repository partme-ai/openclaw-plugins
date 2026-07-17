import { defineConfig } from "tsup";

/**
 * openclaw-web-mqtt tsup 配置
 *
 * aedes/ws 为 CJS，打入 ESM bundle 会触发 dynamic require 错误；
 * 运行时依赖由 OpenClaw npm 安装路径解析。
 */
export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  outDir: "dist",
  external: [/^openclaw(\/.*)?$/, "aedes", "ws"],
});
