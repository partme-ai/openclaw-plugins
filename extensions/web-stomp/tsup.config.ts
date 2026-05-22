import { defineConfig } from "tsup";

/**
 * openclaw_web_stomp tsup 配置
 * noExternal: 将 ws 运行时依赖打包进 dist，
 * 因为 OpenClaw 插件安装只解压 tarball，不运行 npm install
 */
export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
  outDir: "dist",
  external: [/^openclaw(\/.*)?$/],
  noExternal: ["ws"],
});
