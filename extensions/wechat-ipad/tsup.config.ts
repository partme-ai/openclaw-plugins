import { defineConfig } from "tsup";

/**
 * openclaw_wechat_ipad tsup 配置
 * noExternal: ws 打包进 dist（插件安装不运行 npm install）
 */
export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // 与 OpenClaw 2026.7.1 和 package.json engines 保持一致，避免发布物暗示旧宿主受支持。
  target: "node22",
  outDir: "dist",
  noExternal: ["ws"],
});
