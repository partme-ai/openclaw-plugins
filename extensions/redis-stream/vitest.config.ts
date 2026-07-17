/**
 * @fileoverview Redis Stream 测试配置。
 *
 * 默认只运行不依赖外部服务的测试；设置 `REDIS_URL` 后追加真实 Redis 功能测试，避免 CI
 * 在没有 Broker 时把环境缺失误报为代码失败。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: process.env.REDIS_URL ? [] : ["test/functional.test.ts"],
    globals: false,
  },
});
