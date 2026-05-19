import { defineConfig } from "tsup";

/**
 * Redis Stream 插件构建配置。
 *
 * `noExternal: ["redis"]`：将官方 node-redis（npm `redis`）打入 dist，
 * 与 openclaw-rabbitmq 一致——插件 tarball 解压后通常不会单独执行 npm install。
 *
 * @see https://redis.io/docs/latest/develop/clients/nodejs/
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
  noExternal: ["redis"],
});
