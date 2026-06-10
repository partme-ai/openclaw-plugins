import { describe, expect, it } from "vitest";
import {
  DEFAULT_GATEWAY_PORT,
  resolveGatewayPort,
  resolveHooksInfo,
  resolveRegisterIp,
} from "./resolve-endpoint.js";

describe("resolveGatewayPort", () => {
  it("uses OPENCLAW_GATEWAY_PORT when set", () => {
    expect(resolveGatewayPort(undefined, { OPENCLAW_GATEWAY_PORT: "19000" })).toBe(19000);
  });

  it("uses config.gateway.port when env unset", () => {
    expect(resolveGatewayPort({ gateway: { port: 18000 } }, {})).toBe(18000);
  });

  it("defaults to DEFAULT_GATEWAY_PORT", () => {
    expect(resolveGatewayPort(undefined, {})).toBe(DEFAULT_GATEWAY_PORT);
  });
});

describe("resolveHooksInfo", () => {
  it("returns disabled when hooks.enabled is not true", () => {
    const r = resolveHooksInfo({ hooks: { enabled: false } });
    expect(r.hooksEnabled).toBe(false);
    expect(r.hooksBasePath).toBe("/hooks");
  });

  it("normalizes hooks path", () => {
    const r = resolveHooksInfo({ hooks: { enabled: true, path: "api/hooks/" } });
    expect(r.hooksEnabled).toBe(true);
    expect(r.hooksBasePath).toBe("/api/hooks");
  });
});

describe("resolveRegisterIp", () => {
  it("prefers config registerIp", () => {
    expect(
      resolveRegisterIp({
        configIp: "10.0.0.5",
        env: {},
        warn: () => {},
      }),
    ).toBe("10.0.0.5");
  });

  it("uses OPENCLAW_NACOS_REGISTER_IP", () => {
    expect(
      resolveRegisterIp({
        env: { OPENCLAW_NACOS_REGISTER_IP: "10.0.0.9" },
        warn: () => {},
      }),
    ).toBe("10.0.0.9");
  });
});
