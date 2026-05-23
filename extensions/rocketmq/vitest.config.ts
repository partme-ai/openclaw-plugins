import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: process.env.ROCKETMQ_INTEGRATION ? [] : ["test/integration.test.ts"],
  },
});
