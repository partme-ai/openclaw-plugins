import { defineConfig } from "tsup";

/**
 * RocketMQ 插件构建配置。
 * 将运行时依赖打入 dist，避免 OpenClaw 安装插件后再二次安装依赖。
 */
export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
  outDir: "dist",
  external: [/^openclaw(\/.*)?$/, /^rocketmq-client-nodejs$/],
});
