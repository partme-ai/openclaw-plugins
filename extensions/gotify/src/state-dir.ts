import os from "node:os";
import path from "node:path";

/**
 * 解析 OpenClaw 状态目录。
 *
 * 与其他渠道插件保持一致：优先读取 OPENCLAW_STATE_DIR / CLAWDBOT_STATE_DIR，
 * 未配置时回退到 `~/.openclaw`。
 */
export function resolveStateDir(): string {
  return (
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    process.env.CLAWDBOT_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".openclaw")
  );
}
