/**
 * WeChat iPad config resolution tests.
 */
import { describe, expect, it } from "vitest";

import { resolveWechatIpadConfig } from "../src/config.js";
import { DEFAULT_CONFIG } from "../src/types.js";

describe("resolveWechatIpadConfig", () => {
  it("returns defaults when channels.wechat-ipad missing", () => {
    expect(resolveWechatIpadConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial channel config with defaults", () => {
    const cfg = resolveWechatIpadConfig({
      channels: {
        "wechat-ipad": {
          serviceUrl: "ws://custom:6000",
          message: { handleGroup: true },
        },
      },
    });

    expect(cfg.serviceUrl).toBe("ws://custom:6000");
    expect(cfg.apiUrl).toBe(DEFAULT_CONFIG.apiUrl);
    expect(cfg.message.handleGroup).toBe(true);
    expect(cfg.message.groupWhitelist).toEqual([]);
  });

  it("merges nested reconnect and auth settings", () => {
    const cfg = resolveWechatIpadConfig({
      channels: {
        "wechat-ipad": {
          reconnect: { maxRetries: 5 },
          auth: { token: "secret" },
        },
      },
    });

    expect(cfg.reconnect.maxRetries).toBe(5);
    expect(cfg.reconnect.enabled).toBe(DEFAULT_CONFIG.reconnect.enabled);
    expect(cfg.auth.token).toBe("secret");
  });

  it("preserves group whitelist array", () => {
    const cfg = resolveWechatIpadConfig({
      channels: {
        "wechat-ipad": {
          message: {
            handleGroup: true,
            groupWhitelist: ["wxid_group_a"],
            ignoreself: false,
          },
        },
      },
    });

    expect(cfg.message.groupWhitelist).toEqual(["wxid_group_a"]);
    expect(cfg.message.ignoreself).toBe(false);
  });
});
