/**
 * @module media-path-guard
 *
 * 本地媒体 Path Guard — 企微出站/私信读取本机文件时的安全边界。
 *
 * **职责**：
 * - 汇总 `mediaLocalRoots` 白名单（默认根 + stateDir + 用户自定义）
 * - 校验本地路径是否落在白名单根目录下（防目录穿越）
 * - 通过 message-sdk `getPathGuard` 安全读取文件（大小限制 + root 约束）
 *
 * **与 message-sdk 关系**：
 * - 依赖 {@link getPathGuard} 做实际文件 IO（symlink / 越界防护）
 * - 白名单根目录与 message-sdk `media/media-io` 的 inbound 归档路径对齐
 * - 被 Webhook `monitor.ts`、`agent-dm.ts` 及 WS `ws-reply-pipeline.ts` 共用
 *
 * **关键流程**：
 * 1. `getExtendedMediaLocalRoots` → 合并默认 + state + 配置根
 * 2. `resolveAllowedRootForLocalPath` → 路径归属校验
 * 3. `readGuardedLocalMediaFile` → Path Guard 读 Buffer
 *
 * **关键导出**：`getExtendedMediaLocalRoots`、`resolveAllowedRootForLocalPath`、
 * `readGuardedLocalMediaFile`、`GuardedLocalMediaReadResult`
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getPathGuard } from "@partme.ai/openclaw-message-sdk";
import { getDefaultMediaLocalRoots, resolveStateDir } from "../shared/openclaw-compat.js";
import type { WeComConfig } from "../config/wecom-config.js";

/**
 * Path Guard 读取本地媒体的结果。
 *
 * @property ok - 是否读取成功
 * @property buffer - 成功时的文件二进制（仅 ok=true）
 * @property rejectReason - 失败原因分类（not allowed / too large / not found / read failed）
 * @property error - 失败时的详细错误信息（仅 ok=false）
 */
export type GuardedLocalMediaReadResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; rejectReason: string; error: string };

/**
 * 在 `getDefaultMediaLocalRoots()` 基础上扩展 stateDir 与用户自定义 `mediaLocalRoots`。
 *
 * WHY：Agent 保存的 inbound 媒体与 OpenClaw state 目录可能不在 SDK 默认根下，
 * 必须显式加入白名单，否则 Bot/Agent 私信无法读取刚落盘的文件。
 *
 * @param config - 企微渠道配置（可选 `mediaLocalRoots` 扩展项）
 * @returns 去重后的绝对路径白名单根目录列表
 */
export async function getExtendedMediaLocalRoots(config?: WeComConfig): Promise<string[]> {
  const defaults = await getDefaultMediaLocalRoots();
  const roots: string[] = [...defaults];

  const stateDir = path.resolve(resolveStateDir());
  if (!roots.includes(stateDir)) {
    roots.push(stateDir);
  }
  if (config?.mediaLocalRoots) {
    for (const r of config.mediaLocalRoots) {
      const resolved = path.resolve(r.replace(/^~(?=\/|$)/, os.homedir()));
      if (!roots.includes(resolved)) {
        roots.push(resolved);
      }
    }
  }
  return roots;
}

/**
 * 解析本地路径所属的白名单根目录；不在任何根下则返回 `undefined`。
 *
 * WHY：先 `realpath` 再前缀匹配，避免 symlink 绕过白名单；跳过文件系统根（`/`）
 * 防止误将全盘作为合法根。
 *
 * @param mediaPath - 待校验的本地文件路径
 * @param localRoots - 白名单根目录列表
 * @returns 匹配到的根目录绝对路径；无匹配时 `undefined`
 */
export async function resolveAllowedRootForLocalPath(
  mediaPath: string,
  localRoots: readonly string[],
): Promise<string | undefined> {
  if (!localRoots.length) {
    return undefined;
  }

  // 优先解析真实路径，防止 ../ 或 symlink 逃逸
  let resolved: string;
  try {
    resolved = await fs.realpath(mediaPath);
  } catch {
    resolved = path.resolve(mediaPath);
  }

  for (const root of localRoots) {
    let resolvedRoot: string;
    try {
      resolvedRoot = await fs.realpath(root);
    } catch {
      resolvedRoot = path.resolve(root);
    }
    // 禁止将磁盘根目录作为白名单根（过于宽松）
    if (resolvedRoot === path.parse(resolvedRoot).root) {
      continue;
    }
    if (resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)) {
      return resolvedRoot;
    }
  }
  return undefined;
}

/**
 * 在白名单根目录内通过 Path Guard 安全读取本地媒体文件。
 *
 * WHY：Bot 发送本机图片/Agent 私信附件均走此入口，统一大小限制与 root 约束，
 * 拒绝任意路径读取。
 *
 * @param params.filePath - 待读取的本地文件路径
 * @param params.allowedRoots - 白名单根目录（通常来自 {@link getExtendedMediaLocalRoots}）
 * @param params.maxBytes - 可选最大字节数（透传 Path Guard）
 * @returns 成功 `{ ok: true, buffer }` 或失败 `{ ok: false, rejectReason, error }`
 */
export async function readGuardedLocalMediaFile(params: {
  filePath: string;
  allowedRoots: readonly string[];
  maxBytes?: number;
}): Promise<GuardedLocalMediaReadResult> {
  const { filePath, allowedRoots, maxBytes } = params;
  const matchingRoot = await resolveAllowedRootForLocalPath(filePath, allowedRoots);
  if (!matchingRoot) {
    return {
      ok: false,
      rejectReason: "not allowed",
      error: `Local media path is not under an allowed directory: ${filePath}`,
    };
  }

  try {
    let resolvedPath: string;
    try {
      resolvedPath = await fs.realpath(filePath);
    } catch {
      resolvedPath = path.resolve(filePath);
    }

    const guard = await getPathGuard();
    const buffer = await guard.readRegularFile(resolvedPath, {
      rootDir: matchingRoot,
      maxBytes,
    });
    return { ok: true, buffer };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const rejectReason = classifyGuardedReadFailure(message);
    return { ok: false, rejectReason, error: message };
  }
}

/**
 * 将 Path Guard 读失败原因归类为 media 错误摘要可用的 `rejectReason`。
 *
 * @param message - Path Guard 或 fs 抛出的错误消息
 * @returns 标准化拒绝原因：`not allowed` | `too large` | `not found` | `read failed`
 */
function classifyGuardedReadFailure(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("not under") ||
    lower.includes("not allowed") ||
    lower.includes("escapes root")
  ) {
    return "not allowed";
  }
  if (lower.includes("too large")) {
    return "too large";
  }
  if (lower.includes("enoent") || lower.includes("not found")) {
    return "not found";
  }
  return "read failed";
}
