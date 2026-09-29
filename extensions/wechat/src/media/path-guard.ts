/**
 * @module wechat/media/path-guard
 *
 * 微信出站本地媒体的文件系统安全边界。
 *
 * Agent 回复中的 `MEDIA:` 与 message tool 的 `media` 都属于不可信输入，不能直接
 * `readFile()`。本模块先用 OpenClaw 的媒体根目录策略限制可访问范围，再通过
 * `fs-safe` 读取普通文件，阻断目录穿越、符号链接逃逸、特殊文件和超大文件。
 *
 * 数据流：
 * local path -> mediaLocalRoots 白名单 -> realpath 边界 -> fs-safe -> Buffer
 */

import os from "node:os";
import path from "node:path";

import {
  getAgentScopedMediaLocalRoots,
} from "openclaw/plugin-sdk/media-local-roots";
import { readLocalFileFromRoots } from "openclaw/plugin-sdk/infra-runtime";

/** 合并 OpenClaw 默认媒体根与管理员为当前微信账号扩展的可信目录。 */
export function resolveWeixinMediaLocalRoots(customRoots?: readonly string[]): string[] {
  const roots = [...getAgentScopedMediaLocalRoots({})];
  for (const root of customRoots ?? []) {
    const normalized = path.resolve(root.trim().replace(/^~(?=\/|$)/u, os.homedir()));
    if (normalized !== path.parse(normalized).root && !roots.includes(normalized)) {
      roots.push(normalized);
    }
  }
  return roots;
}

/**
 * 在账号白名单内读取普通文件，并实施真实字节上限。
 *
 * `readLocalFileFromRoots` 将根目录约束、文件类型和大小限制绑定到同一次打开。
 */
export async function readWeixinLocalMedia(params: {
  filePath: string;
  customRoots?: readonly string[];
  maxBytes: number;
}): Promise<Buffer> {
  const roots = resolveWeixinMediaLocalRoots(params.customRoots);
  const result = await readLocalFileFromRoots({
    filePath: params.filePath,
    roots,
    maxBytes: params.maxBytes,
  });
  if (!result) {
    throw new Error(`Local media path is not under an allowed directory or is unsafe: ${params.filePath}`);
  }
  return result.buffer;
}
