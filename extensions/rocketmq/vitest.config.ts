/**
 * RocketMQ 插件测试配置。
 *
 * 默认只运行无需外部 Broker 的单元测试；显式设置 `ROCKETMQ_INTEGRATION=1`
 * 时才纳入真实 RocketMQ 集成用例，避免普通开发机误报网络故障。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: process.env.ROCKETMQ_INTEGRATION ? [] : ["test/integration.test.ts"],
  },
});
