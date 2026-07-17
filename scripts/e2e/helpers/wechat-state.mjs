/** 为隔离 WeChat E2E 写入最小私有账号状态；不会读取用户真实 OpenClaw profile。 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATE_DIR } from "../lib/utils.mjs";

function writePrivateJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

export function prepareWechatState() {
  const accountId = "e2e-im-bot";
  writePrivateJson(join(STATE_DIR, "openclaw-weixin", "accounts.json"), [accountId]);
  writePrivateJson(join(STATE_DIR, "openclaw-weixin", "accounts", `${accountId}.json`), {
    token: "wechat-e2e-token",
    userId: "wechat-e2e-user@im.wechat",
    savedAt: new Date().toISOString(),
  });
  writePrivateJson(join(STATE_DIR, "credentials", `openclaw-weixin-${accountId}-allowFrom.json`), {
    allowFrom: ["wechat-e2e-user@im.wechat"],
  });
}
