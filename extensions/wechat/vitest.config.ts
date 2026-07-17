import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // 账号/游标兼容测试会 resetModules 后重新加载 OpenClaw 2026.7.1 的插件运行时；
    // 并行覆盖率采集时首次模块图构建在较慢 CI 上可能超过 Vitest 默认 5 秒。
    testTimeout: 15_000,
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/api/types.ts",
        "src/types/vendor.d.ts",
        "src/util/logger.ts",
        "src/monitor/monitor.ts",
        "src/channel.ts",
        "src/auth/login-qr.ts",
        "src/media/media-download.ts",
        "src/cdn/pic-decrypt.ts",
        "src/auth/accounts.ts",
        "src/channel-setup-factory.ts",
        "src/media/thumbnail.ts",
        "src/messaging/process-message.ts",
        "src/onboarding.ts",
        "src/runtime.ts",
        "src/cdn/aes-ecb.ts",
        "src/cdn/cdn-url.ts",
        "src/index.ts",
        "src/setup-entry.ts",
        "src/inbound.ts",
        "src/outbound.ts",
        "src/config.ts",
        "src/types.ts",
        "src/transport/server.ts",
      ],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
