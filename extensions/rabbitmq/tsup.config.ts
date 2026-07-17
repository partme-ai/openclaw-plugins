/**
 * @fileoverview RabbitMQ 插件构建配置。
 *
 * `amqplib` 被打入插件产物，因为 OpenClaw 的本地插件安装路径只解包 tarball，不能假定
 * Gateway 工作目录已安装该依赖；`openclaw/*` 则必须保持 external，由宿主 2026.7.1
 * 运行时提供，避免打包第二份 SDK 造成类型和全局状态分裂。
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/setup-entry.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  outDir: "dist",
  /** OpenClaw 由 Gateway 运行时提供，不得打入 dist */
  external: [/^openclaw(\/.*)?$/],
  noExternal: ["amqplib"],
});
