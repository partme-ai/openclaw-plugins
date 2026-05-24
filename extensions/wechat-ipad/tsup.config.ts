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
  target: "node20",
  outDir: "dist",
  noExternal: ["ws"],
});
