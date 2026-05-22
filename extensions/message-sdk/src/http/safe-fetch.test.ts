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
