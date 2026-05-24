/**
 * Proxy factory unit tests.
 */
import { describe, expect, it } from "vitest";

import { createProxyService } from "./proxy.js";
import { HttpProxyServer } from "./http-proxy.js";

describe("createProxyService", () => {
  it("returns HttpProxyServer for http protocol", () => {
    const svc = createProxyService({ port: 18790, protocol: "http", timeout: 1000 });
    expect(svc).toBeInstanceOf(HttpProxyServer);
  });

  it("throws for unknown proxy protocol", () => {
    expect(() =>
      createProxyService({ port: 1, protocol: "ws" as "http", timeout: 1 }),
    ).toThrow(/Unknown proxy protocol/);
  });
});
