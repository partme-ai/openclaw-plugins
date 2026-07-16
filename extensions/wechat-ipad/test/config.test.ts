import { describe, expect, it } from "vitest";
import { resolveWechatIpadConfig } from "../src/config.js";
import { DEFAULT_CONFIG } from "../src/types.js";

describe("resolveWechatIpadConfig", () => {
  it("is disabled and fail-closed by default", () => {
    expect(resolveWechatIpadConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("requires explicit unofficial protocol acknowledgement", () => {
    expect(() => resolveWechatIpadConfig({ enabled: true })).toThrow(
      "acknowledgeUnofficialProtocolRisk",
    );
  });

  it("rejects unknown fields at runtime", () => {
    expect(() => resolveWechatIpadConfig({ typoEnabled: true })).toThrow("unknown config field");
    expect(() => resolveWechatIpadConfig({ network: { timeout: 1 } })).toThrow("unknown network field");
  });

  it("rejects plaintext remote endpoints and URL credentials", () => {
    expect(() => resolveWechatIpadConfig({ serviceUrl: "ws://bridge.example.com" })).toThrow("wss");
    expect(() => resolveWechatIpadConfig({ apiUrl: "https://user:pass@example.com" })).toThrow("credentials");
  });

  it("accepts loopback plaintext endpoints and environment token", () => {
    const config = resolveWechatIpadConfig(
      {
        enabled: true,
        acknowledgeUnofficialProtocolRisk: true,
        serviceUrl: "ws://127.0.0.1:6000",
        apiUrl: "http://localhost:6001",
      },
      { WECHAT_IPAD_BRIDGE_TOKEN: " env-secret " },
    );
    expect(config.auth.token).toBe("env-secret");
    expect(config.serviceUrl).toBe("ws://127.0.0.1:6000");
  });

  it("fails closed for groups unless explicitly scoped", () => {
    const base = { enabled: true, acknowledgeUnofficialProtocolRisk: true };
    expect(() => resolveWechatIpadConfig({ ...base, message: { handleGroup: true } })).toThrow(
      "groupWhitelist",
    );
    expect(resolveWechatIpadConfig({
      ...base,
      message: { handleGroup: true, groupWhitelist: [" group-a ", "group-a"] },
    }).message.groupWhitelist).toEqual(["group-a"]);
  });
});
