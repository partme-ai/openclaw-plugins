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

import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import {
  getAgentScopedMediaLocalRoots,
} from "openclaw/plugin-sdk/media-local-roots";
import { readLocalFileFromRoots } from "openclaw/plugin-sdk/infra-runtime";

/** 仅由宿主路由或出站上下文提供；不得从待上传文件路径推导。 */
export type WeixinMediaSessionContext = {
  cfg?: OpenClawConfig;
  agentId?: string;
  sessionWorkspaceDir?: string;
};

/** 合并 OpenClaw 当前 agent/session 根与管理员为微信账号扩展的可信目录。 */
export function resolveWeixinMediaLocalRoots(
  context: WeixinMediaSessionContext & { customRoots?: readonly string[] } = {},
): string[] {
  const roots = [
    ...getAgentScopedMediaLocalRoots(context.cfg ?? {}, context.agentId, context.sessionWorkspaceDir),
  ];
  for (const root of context.customRoots ?? []) {
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
export async function readWeixinLocalMedia(params: WeixinMediaSessionContext & {
  filePath: string;
  customRoots?: readonly string[];
  maxBytes: number;
}): Promise<Buffer> {
  const roots = resolveWeixinMediaLocalRoots(params);
  // The SDK canonicalizes roots (for example macOS /var -> /private/var).
  // Canonicalize only the parent alias; fs-safe still checks the final file at open.
  const filePath = path.join(
    await realpath(path.dirname(params.filePath)),
    path.basename(params.filePath),
  );
  const result = await readLocalFileFromRoots({
    filePath,
    roots,
    maxBytes: params.maxBytes,
  });
  if (!result) {
    throw new Error(`Local media path is not under an allowed directory or is unsafe: ${params.filePath}`);
  }
  return result.buffer;
}
