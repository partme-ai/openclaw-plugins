import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: process.env.REDIS_URL ? [] : ["test/functional.test.ts"],
    globals: false,
  },
});
