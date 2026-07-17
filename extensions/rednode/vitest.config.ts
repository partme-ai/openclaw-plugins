import { defineConfig } from "vitest/config";

/** Rednode Ark 签名、配置、工具边界与重试契约测试配置。 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: false,
  },
});
