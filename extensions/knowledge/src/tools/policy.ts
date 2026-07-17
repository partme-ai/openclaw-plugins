import { isAbsolute, relative, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/plugin-entry';
import type { KnowledgeConfig } from '../types.js';
import { resolveConversationNamespace } from '../runtime/namespace.js';

const NAMESPACE_PATTERN = /^[A-Za-z0-9._-]{1,128}:(bot|agent)$/;
const GLOBAL_NAMESPACE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const SOURCE_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/u;

/**
 * 从 OpenClaw Tool 官方上下文生成调用者自己的知识库命名空间。
 * Tool 与 before_prompt_build 都使用 sessionKey 摘要，避免两条路径因不存在的 Hook
 * accountId 产生不同隔离键；原始会话标识不会进入路径、表名或响应。
 */
export function defaultNamespace(ctx: OpenClawPluginToolContext): string {
  return resolveConversationNamespace(ctx);
}

/**
 * 校验 Tool 请求是否有权访问目标 namespace。
 * 普通发送者只能访问当前会话空间；owner 可跨空间，但仍受
 * `allowOwnerGlobalNamespaces` 总开关约束，避免模型自行扩大读写范围。
 */
export function authorizeNamespace(
  ctx: OpenClawPluginToolContext,
  requested: unknown,
  config: KnowledgeConfig,
): { ok: true; namespace: string } | { ok: false; error: string } {
  const own = defaultNamespace(ctx);
  const namespace = requested === undefined ? own : typeof requested === 'string' ? requested.trim() : '';
  if (!namespace || (!NAMESPACE_PATTERN.test(namespace) && !GLOBAL_NAMESPACE_PATTERN.test(namespace))) {
    return { ok: false, error: 'namespace 格式无效（仅允许字母、数字、点、下划线、短横线及可选 :bot/:agent）' };
  }
  if (namespace === own) return { ok: true, namespace };
  if (ctx.senderIsOwner !== true) {
    return { ok: false, error: '只能访问当前对话自己的 namespace' };
  }
  if (config.tools?.allowOwnerGlobalNamespaces === false) {
    return { ok: false, error: '配置已禁止 owner 跨 namespace 操作' };
  }
  return { ok: true, namespace };
}

/** 校验稳定来源标识，拒绝控制字符和超过 256 字符的持久化键。 */
export function validateSourceId(value: unknown, fallback: string): { ok: true; sourceId: string } | { ok: false; error: string } {
  const sourceId = typeof value === 'string' && value.trim() ? value.trim() : fallback.trim();
  return SOURCE_ID_PATTERN.test(sourceId)
    ? { ok: true, sourceId }
    : { ok: false, error: 'sourceId 必须是 1-256 个非控制字符' };
}

/** 在切块和 Embedding 前限制文本字符数，避免单次 Tool 调用耗尽内存或远端额度。 */
export function validateTextSize(value: string, config: KnowledgeConfig, field: string): string | undefined {
  const max = config.tools?.maxInputChars ?? 100_000;
  return value.length <= max ? undefined : `${field} 超过最大长度 ${max} 字符`;
}

/**
 * 对文件摄取执行 owner、功能开关、绝对路径和真实路径白名单四层授权。
 * `realpath` 会解析符号链接后再比较根目录，从而阻止通过软链接逃逸 allowedFileRoots；
 * 返回的最大字节数由调用方在读取前强制执行。
 */
export async function authorizeFilePath(
  ctx: OpenClawPluginToolContext,
  filePath: string,
  config: KnowledgeConfig,
): Promise<{ ok: true; filePath: string; maxFileBytes: number } | { ok: false; error: string }> {
  if (ctx.senderIsOwner !== true) return { ok: false, error: 'store_file/file 更新仅允许 owner 执行' };
  if (config.tools?.allowFileIngest !== true) return { ok: false, error: '文件摄取未启用（tools.allowFileIngest=false）' };
  if (!isAbsolute(filePath)) return { ok: false, error: 'filePath 必须是绝对路径' };
  const roots = config.tools.allowedFileRoots ?? [];
  if (roots.length === 0) return { ok: false, error: '文件摄取未配置 tools.allowedFileRoots' };
  let resolved: string;
  let resolvedRoots: string[];
  try {
    resolved = await realpath(resolve(filePath));
    resolvedRoots = await Promise.all(roots.map((root) => realpath(resolve(root))));
  } catch {
    return { ok: false, error: 'filePath 或 allowedFileRoots 不存在或无法解析' };
  }
  const allowed = resolvedRoots.some((root) => {
    const rel = relative(root, resolved);
    return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
  });
  if (!allowed) return { ok: false, error: 'filePath 不在允许的文件根目录内' };
  return { ok: true, filePath: resolved, maxFileBytes: config.tools.maxFileBytes ?? 10 * 1024 * 1024 };
}
