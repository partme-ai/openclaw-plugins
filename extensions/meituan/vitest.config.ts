import { defineConfig } from "vitest/config";

/** 美团签名、白名单、风险确认和真实本地表单契约测试配置。 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: false,
  },
});
