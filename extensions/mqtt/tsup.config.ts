import { defineConfig } from "tsup";

/**
 * openclaw-mqtt tsup 配置
 *
 * - aedes 及其持久化后端为 CJS，必须 external，否则触发 dynamic require 错误。
 * - @partme.ai/openclaw-message-sdk 打入 bundle：npm 版 exports 仍指向 src/*.ts，
 *   在 OpenClaw jiti 加载路径下会失败。
 * - undici 保持 external（CJS assert 动态 require，与 wecom 插件一致）。
 */
export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  outDir: "dist",
  /** OpenClaw 由 Gateway 运行时提供，不得打入 dist */
  external: [
    /^openclaw(\/.*)?$/,
    "aedes",
    "aedes-persistence-redis",
    "aedes-persistence-mongodb",
    "aedes-persistence-level",
    "level",
    "ioredis",
    "mqemitter-redis",
    "ws",
    "undici",
  ],
  noExternal: [/^@partme\.ai\/openclaw-message-sdk(\/.*)?$/],
});
