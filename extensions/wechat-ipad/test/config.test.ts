import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveWechatIpadConfig, WECHAT_IPAD_CONFIG_JSON_SCHEMA } from "../src/config.js";
import { DEFAULT_CONFIG } from "../src/types.js";

describe("resolveWechatIpadConfig", () => {
  it("keeps runtime, plugin and Channel schemas identical", () => {
    const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8")) as {
      configSchema: unknown;
      channelConfigs: { "wechat-ipad": { schema: unknown } };
    };
    expect(manifest.configSchema).toEqual(WECHAT_IPAD_CONFIG_JSON_SCHEMA);
    expect(manifest.channelConfigs["wechat-ipad"].schema).toEqual(WECHAT_IPAD_CONFIG_JSON_SCHEMA);
  });

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

  it("rejects mistyped booleans instead of silently applying defaults", () => {
    expect(() => resolveWechatIpadConfig({ enabled: "false" })).toThrow("enabled must be a boolean");
    expect(() => resolveWechatIpadConfig({ message: { ignoreSelf: 1 } })).toThrow(
      "message.ignoreSelf must be a boolean",
    );
    expect(() => resolveWechatIpadConfig({ reconnect: { enabled: "yes" } })).toThrow(
      "reconnect.enabled must be a boolean",
    );
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
        message: { allowFrom: ["wxid-owner"] },
      },
      { WECHAT_IPAD_BRIDGE_TOKEN: " env-secret " },
    );
    expect(config.auth.token).toBe("env-secret");
    expect(config.serviceUrl).toBe("ws://127.0.0.1:6000");
  });

  it("fails closed for groups unless explicitly scoped", () => {
    const base = {
      enabled: true,
      acknowledgeUnofficialProtocolRisk: true,
      message: { dmPolicy: "disabled" as const },
    };
    expect(() => resolveWechatIpadConfig({ ...base, message: { ...base.message, handleGroup: true } })).toThrow(
      "groupWhitelist",
    );
    expect(resolveWechatIpadConfig({
      ...base,
      message: { ...base.message, handleGroup: true, groupWhitelist: [" group-a ", "group-a"] },
    }).message.groupWhitelist).toEqual(["group-a"]);
  });

  it("requires an explicit DM policy and separates conversation from command authorization", () => {
    const base = { enabled: true, acknowledgeUnofficialProtocolRisk: true };
    expect(() => resolveWechatIpadConfig(base)).toThrow("message.allowFrom");
    const config = resolveWechatIpadConfig({
      ...base,
      message: { allowFrom: ["wxid-user"], commandAllowFrom: ["wxid-owner"] },
    });
    expect(config.message).toMatchObject({
      dmPolicy: "allowlist",
      allowFrom: ["wxid-user"],
      commandAllowFrom: ["wxid-owner"],
    });
    expect(resolveWechatIpadConfig({
      ...base,
      message: { dmPolicy: "disabled" },
    }).message.dmPolicy).toBe("disabled");
  });

  it("requires authentication for remote bridges and explicit approval for split hosts", () => {
    const base = {
      enabled: true,
      acknowledgeUnofficialProtocolRisk: true,
      message: { dmPolicy: "disabled" as const },
      serviceUrl: "wss://events.example.com",
      apiUrl: "https://events.example.com",
    };
    expect(() => resolveWechatIpadConfig(base)).toThrow("auth.token");
    expect(() => resolveWechatIpadConfig({
      ...base,
      apiUrl: "https://api.example.com",
      auth: { token: "secret" },
    })).toThrow("allowSplitBridgeHosts");
    expect(resolveWechatIpadConfig({
      ...base,
      apiUrl: "https://api.example.com",
      allowSplitBridgeHosts: true,
      auth: { token: "secret" },
    }).allowSplitBridgeHosts).toBe(true);
  });

  it("rejects malformed objects, header injection and unsafe wxids", () => {
    expect(() => resolveWechatIpadConfig({ auth: "secret" })).toThrow("auth must be an object");
    expect(() => resolveWechatIpadConfig({ auth: { token: "safe\r\nforged: true" } })).toThrow(
      "control characters",
    );
    expect(() => resolveWechatIpadConfig({ message: { allowFrom: ["wxid ok"] } })).toThrow(
      "valid wxids",
    );
  });
});
