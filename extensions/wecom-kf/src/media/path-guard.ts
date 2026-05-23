/**
 * @module media-path-guard
 *
 * 本地媒体 Path Guard — 出站/私信读取本机文件时的安全边界（委托 message-sdk getPathGuard）。
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getPathGuard } from "@partme.ai/openclaw-message-sdk";

import { getDefaultMediaLocalRoots } from "./local-roots.js";
import { resolveStateDir } from "../state/state-dir-resolve.js";
import type { WecomConfig } from "../types/config.js";

export type GuardedLocalMediaReadResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; rejectReason: string; error: string };

/**
 * 合并默认根、stateDir 与用户自定义 `mediaLocalRoots`。
 */
export async function getExtendedMediaLocalRoots(config?: WecomConfig): Promise<string[]> {
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
 * 解析本地路径所属的白名单根目录。
 */
export async function resolveAllowedRootForLocalPath(
  mediaPath: string,
  localRoots: readonly string[],
): Promise<string | undefined> {
  if (!localRoots.length) {
    return undefined;
  }

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
