/**
 * @module openclaw/state-dir
 *
 * OpenClaw 状态目录解析 / Resolve OpenClaw state directory path.
 *
 * **职责**：确定 OpenClaw 运行时状态根目录（配对存储、会话文件等），支持环境变量覆盖。
 *
 * **适用场景**：读取 pairing allowlist、持久化通道状态、媒体缓存路径。
 *
 * **上下游**：
 * - 上游：进程环境变量 `OPENCLAW_STATE_DIR` / `CLAWDBOT_STATE_DIR`
 * - 下游：各插件文件 I/O、OpenClaw 核心状态读写
 *
 * **关键导出**：`resolveOpenClawStateDir`
 */

import * as path from "node:path";
import * as os from "node:os";

/**
 * 解析 OpenClaw 状态目录。
 *
 * **优先级**：
 * 1. `OPENCLAW_STATE_DIR`
 * 2. `CLAWDBOT_STATE_DIR`（遗留别名）
 * 3. `~/.openclaw`
 *
 * @returns 绝对路径字符串 / Absolute state directory path
 *
 * @example
 * ```ts
 * const stateDir = resolveOpenClawStateDir();
 * const pairingPath = path.join(stateDir, "pairing", channelId);
 * ```
 */
export function resolveOpenClawStateDir(): string {
  const stateOverride =
    process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
  if (stateOverride) {
    return stateOverride;
  }
  return path.join(os.homedir(), ".openclaw");
}
