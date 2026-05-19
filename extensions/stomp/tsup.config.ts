import { defineConfig } from "tsup";

/**
 * openclaw-stomp tsup 配置
 * STOMP 自实现无外部依赖，标准构建即可
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
});
