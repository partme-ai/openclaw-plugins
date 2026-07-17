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
  assertLocalMediaAllowed,
  getDefaultMediaLocalRoots,
} from "openclaw/plugin-sdk/media-runtime";
import { readRegularFile } from "openclaw/plugin-sdk/security-runtime";

/** 合并 OpenClaw 默认媒体根与管理员为当前微信账号扩展的可信目录。 */
export function resolveWeixinMediaLocalRoots(customRoots?: readonly string[]): string[] {
  const roots = [...getDefaultMediaLocalRoots()];
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
 * `assertLocalMediaAllowed` 负责 OpenClaw 统一路径策略，`readRegularFile` 负责打开时
 * 的文件类型/链接安全与大小检查；两层不能用普通 `stat + readFile` 替代。
 */
export async function readWeixinLocalMedia(params: {
  filePath: string;
  customRoots?: readonly string[];
  maxBytes: number;
}): Promise<Buffer> {
  const roots = resolveWeixinMediaLocalRoots(params.customRoots);
  await assertLocalMediaAllowed(params.filePath, roots);
  const result = await readRegularFile({
    filePath: params.filePath,
    maxBytes: params.maxBytes,
  });
  return result.buffer;
}
