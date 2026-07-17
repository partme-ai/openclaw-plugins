import { describe, expect, it } from "vitest";

import { redactHttpUrlForLog } from "./undici-fetch.js";

describe("redactHttpUrlForLog", () => {
  it("脱敏企业微信 query 凭据并保留非敏感定位参数", () => {
    const safe = redactHttpUrlForLog(
      "https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=token-value&open_kfid=wk-1",
    );

    expect(safe).toContain("access_token=%5BREDACTED%5D");
    expect(safe).toContain("open_kfid=wk-1");
    expect(safe).not.toContain("token-value");
  });

  it("脱敏 URL 用户信息、corpsecret 与代理密码", () => {
    const safe = redactHttpUrlForLog(
      "https://proxy-user:proxy-pass@example.com/gettoken?corpid=ww1&corpsecret=corp-secret#fragment",
    );

    expect(safe).not.toContain("proxy-user");
    expect(safe).not.toContain("proxy-pass");
    expect(safe).not.toContain("corp-secret");
    expect(safe).not.toContain("fragment");
    expect(safe).toContain("corpid=ww1");
  });
});
