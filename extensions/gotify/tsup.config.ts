/**
 * Gotify 插件构建配置：生成 Node.js 22 ESM 与类型声明；运行时依赖打包，
 * OpenClaw 保持 external，由宿主提供唯一 SDK 实例。
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  target: "node22",
  outDir: "dist",
  external: [/^openclaw(\/.*)?$/],
  noExternal: ["@partme.ai/openclaw-message-sdk", "ws", "zod"],
});
