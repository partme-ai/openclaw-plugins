/**
 * safe-fetch.test.ts — HTTP 请求、Webhook body 限制与安全 fetch 工具。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, expect, it } from "vitest";
import { safeFetch } from "./safe-fetch.js";

describe("safeFetch", () => {
  it("blocks localhost URLs", async () => {
    await expect(safeFetch("http://127.0.0.1/test")).rejects.toThrow(/blocked URL/);
  });

  it("blocks file protocol", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow(/blocked URL/);
  });
});
