/**
 * @fileoverview `knowledge_delete` — 知识库 **删除/清空** Tool。
 *
 * @description 支持 `delete_by_source` 与 namespace 级 `clear`；含 owner/会话 NS ACL。
 * **模块角色**：Knowledge Plugin · Agent tool (delete path)。
 *
 * @module knowledge/tools/knowledge-delete
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenClawPluginToolContext = any;
type AgentToolResult<T = unknown> = {
  content: { type: 'text'; text: string }[];
  details: T | undefined;
};

import { getOrCreateStore, invalidateStoreCache } from '../runtime/hooks.js';

// ===================================================================
// 类型定义
// ===================================================================

interface KnowledgeDeleteParams {
  /** 操作类型 */
  action: 'delete_by_source' | 'clear';
  /** delete_by_source 时必填：要删除的来源标识 */
  sourceId?: string;
  /** 知识库命名空间（默认对话级别） */
  namespace?: string;
}

// ===================================================================
// 命名空间校验
// ===================================================================

const SESSION_NS_PATTERN = /^[^:]+:(bot|agent)$/;

function isSessionNamespace(namespace: string): boolean {
  return SESSION_NS_PATTERN.test(namespace);
}

// ===================================================================
// 响应构造
// ===================================================================

function successResult(data: Record<string, unknown>): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: true, ...data }) }],
    details: undefined,
  };
}

function failedResult(message: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }) }],
    details: undefined,
  };
}

// ===================================================================
// 获取共享配置
// ===================================================================

function buildBaseConfig(ctx: OpenClawPluginToolContext): import('../types.js').KnowledgeConfig {
  const knowledgeConfig = (ctx.pluginConfig ?? {}) as import('../types.js').KnowledgeConfig;
  if (knowledgeConfig.enabled ?? true) {
    return knowledgeConfig;
  }
  return { enabled: true };
}

// ===================================================================
// 工具定义
// ===================================================================

/**
 * 创建 wecom_knowledge_delete Tool 定义
 */
/**
 * @description 注册 `knowledge_delete` Tool — `delete_by_source` 或 namespace `clear`。
 *
 * @param ctx - OpenClaw Tool 上下文。
 * @returns Agent Tool 描述对象。
 */
export function createKnowledgeDeleteTool(ctx: OpenClawPluginToolContext) {
  return {
    name: 'knowledge_delete',
    label: '知识库删除',
    description: [
      '从本地知识库中删除数据。',
      '',
      '支持两种操作（由 action 参数区分）：',
      '',
      '1. delete_by_source — 按 sourceId 删除特定来源的所有内容',
      '   - sourceId（必填）：要删除的来源标识',
      '   - namespace（可选）：知识库命名空间，默认对话级别',
      '',
      '2. clear — 清空整个命名空间的所有知识库数据（谨慎操作！）',
      '   - namespace（可选）：要清空的命名空间，默认对话级别',
      '   - 注意：clear 只能由 owner 执行，且不可恢复',
      '',
      '权限规则：',
      '- 任何用户都可以删除自己对话级 namespace（{accountId}:{mode}）下的数据',
      '- 只有 owner 才能操作非对话级 namespace（如 enterprise, global）',
      '- clear 操作只能在对话级 namespace 或 owner 执行',
    ].join('\n'),
    parameters: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['delete_by_source', 'clear'],
          description: '操作类型：delete_by_source（按来源删除）、clear（清空整个命名空间）',
        },
        sourceId: {
          type: 'string',
          description: '要删除的来源标识（action=delete_by_source 时必填）',
        },
        namespace: {
          type: 'string',
          description: '知识库命名空间，默认当前对话命名空间（{accountId}:{mode}）',
        },
      },
      required: ['action'],
    },
    async execute(_toolCallId: string, params: unknown) {
      const p = params as KnowledgeDeleteParams;

      if (!p.action) {
        return failedResult('缺少必填参数 action');
      }

      let namespace = p.namespace;
      if (!namespace) {
        const accountId = ctx.agentAccountId ?? 'default';
        const mode = ctx.agentId ? 'agent' : 'bot';
        namespace = `${accountId}:${mode}`;
      }

      // 权限校验
      if (!isSessionNamespace(namespace) && !ctx.senderIsOwner) {
        return failedResult('只有 owner 才能操作非对话级 namespace 的知识库');
      }

      const config = buildBaseConfig(ctx);

      try {
        const { store } = await getOrCreateStore(config, namespace);

        if (p.action === 'delete_by_source') {
          if (!p.sourceId || typeof p.sourceId !== 'string' || p.sourceId.trim().length === 0) {
            return failedResult('action=delete_by_source 时必须提供非空的 sourceId 参数');
          }
          const sourceId = p.sourceId.trim();
          await store.deleteBySource(sourceId);
          return successResult({ action: 'delete_by_source', sourceId, namespace });
        }

        if (p.action === 'clear') {
          // clear 只在对话级 namespace 或 owner 执行过（前面已校验）
          await store.clear();
          // 清除缓存，确保后续操作重新初始化
          invalidateStoreCache(namespace);
          return successResult({ action: 'clear', namespace });
        }

        return failedResult(`未知操作类型: ${String(p.action)}，支持 delete_by_source、clear`);
      } catch (err) {
        return failedResult(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
