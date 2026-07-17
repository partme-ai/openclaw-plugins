/**
 * @fileoverview Knowledge 自动检索与 Tool 的统一命名空间解析器。
 *
 * OpenClaw 2026.7.1 的 `before_prompt_build` 上下文不包含 `accountId`，但 Hook 与
 * Tool 都会收到稳定的 `sessionKey`。因此默认隔离键必须从 sessionKey 派生；若继续
 * 让 Hook 读取不存在的 accountId，真实多账号环境会把 Tool 写入和自动检索分到两个库。
 * 原始 sessionKey 只参与 SHA-256，不写入表名、文件名或 Tool 返回值。
 */
import { createHash } from 'node:crypto';

export type KnowledgeNamespaceContext = {
  sessionKey?: string;
  agentId?: string;
};

/**
 * 从 OpenClaw 官方上下文生成稳定的会话级 namespace。
 *
 * `/new` 和 Gateway 重启不会改变同一会话的 sessionKey；缺失 sessionKey 的一次性
 * 本地调用回退到 legacy `default:{mode}`，保证 CLI/库式 API 仍有明确行为。
 */
export function resolveConversationNamespace(ctx: KnowledgeNamespaceContext): string {
  const mode = ctx.agentId?.trim() ? 'agent' : 'bot';
  const sessionKey = ctx.sessionKey?.trim();
  if (!sessionKey) return `default:${mode}`;
  const digest = createHash('sha256').update(sessionKey).digest('hex').slice(0, 24);
  return `session-${digest}:${mode}`;
}
