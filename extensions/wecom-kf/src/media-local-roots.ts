/**
 * 默认媒体本地根目录（优先 OpenClaw SDK，fallback 与 stateDir 对齐）。
 */
import * as path from "node:path";

import { resolveStateDir } from "./state-dir-resolve.js";

/**
 * 获取默认媒体本地路径白名单。
 */
export async function getDefaultMediaLocalRoots(): Promise<readonly string[]> {
  try {
    const sdk = (await import("openclaw/plugin-sdk/core")) as {
      getDefaultMediaLocalRoots?: () => readonly string[];
    };
    if (typeof sdk.getDefaultMediaLocalRoots === "function") {
      return sdk.getDefaultMediaLocalRoots();
    }
  } catch {
    // plugin-sdk 不可用或版本过低
  }

  const stateDir = path.resolve(resolveStateDir());
  return [
    path.join(stateDir, "media"),
    path.join(stateDir, "agents"),
    path.join(stateDir, "workspace"),
    path.join(stateDir, "sandboxes"),
  ];
}
