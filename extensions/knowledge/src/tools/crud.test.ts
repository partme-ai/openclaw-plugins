import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeConfig, VectorChunk } from '../types.js';

const mocks = vi.hoisted(() => {
  const store = {
    replaceBySource: vi.fn(async () => undefined),
    deleteBySource: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };
  const embedding = {
    dimensions: 3,
    modelName: 'fixture',
    embedBatch: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  };
  return { store, embedding, getOrCreateStore: vi.fn(async () => ({ store, embedding })) };
});

vi.mock('../runtime/hooks.js', () => ({ getOrCreateStore: mocks.getOrCreateStore }));

import { createKnowledgeAddTool } from './knowledge-add.js';
import { createKnowledgeUpdateTool } from './knowledge-update.js';
import { createKnowledgeDeleteTool } from './knowledge-delete.js';
import { resolveConversationNamespace } from '../runtime/namespace.js';

const context = {
  sessionKey: 'agent:main:wecom:tenant:user',
  agentId: 'main',
  senderIsOwner: false,
};
const config: KnowledgeConfig = {
  enabled: true,
  embedding: { provider: 'ollama', dimensions: 3 },
  tools: { maxInputChars: 1_000 },
};

function payload(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('knowledge CRUD Tool 契约', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('add/store_text 使用会话摘要 namespace，并一次性 replaceBySource', async () => {
    const tool = createKnowledgeAddTool(context as never, config);
    const result = await tool.execute('call-add', {
      action: 'store_text',
      sourceId: 'handbook',
      content: '生产发布必须先通过回归测试。',
    });

    expect(payload(result)).toMatchObject({ success: true, sourceId: 'handbook', chunksAdded: 1 });
    expect(mocks.getOrCreateStore).toHaveBeenCalledWith(config, resolveConversationNamespace(context));
    expect(mocks.store.replaceBySource).toHaveBeenCalledOnce();
    const [sourceId, chunks] = mocks.store.replaceBySource.mock.calls[0] as unknown as [string, VectorChunk[]];
    expect(sourceId).toBe('handbook');
    expect(chunks[0]).toMatchObject({
      id: 'doc:handbook:0',
      vector: [0.1, 0.2, 0.3],
      metadata: { sourceId: 'handbook', source: 'knowledge_add' },
    });
  });

  it('update/text 保持 sourceId，并在 Embedding 后原子替换整组 chunks', async () => {
    const tool = createKnowledgeUpdateTool(context as never, config);
    const result = await tool.execute('call-update', {
      sourceId: 'handbook',
      updateType: 'text',
      content: '新版发布规则。',
    });

    expect(payload(result)).toMatchObject({ success: true, sourceId: 'handbook', chunksUpdated: 1 });
    expect(mocks.store.replaceBySource).toHaveBeenCalledOnce();
    const [sourceId, chunks] = mocks.store.replaceBySource.mock.calls[0] as unknown as [string, VectorChunk[]];
    expect(sourceId).toBe('handbook');
    expect(chunks[0].metadata).toMatchObject({ source: 'knowledge_update', text: '新版发布规则。' });
  });

  it('delete_by_source 与 clear 分别走 source 锁和 Store 独占屏障', async () => {
    const tool = createKnowledgeDeleteTool(context as never, config);

    const deleted = await tool.execute('call-delete', { action: 'delete_by_source', sourceId: 'handbook' });
    const cleared = await tool.execute('call-clear', { action: 'clear' });

    expect(payload(deleted)).toMatchObject({ success: true, action: 'delete_by_source', sourceId: 'handbook' });
    expect(payload(cleared)).toMatchObject({ success: true, action: 'clear' });
    expect(mocks.store.deleteBySource).toHaveBeenCalledWith('handbook');
    expect(mocks.store.clear).toHaveBeenCalledOnce();
  });

  it('普通调用方跨 namespace 在 Store 初始化前被拒绝', async () => {
    const tool = createKnowledgeAddTool(context as never, config);
    const result = await tool.execute('call-denied', {
      action: 'store_text',
      namespace: 'enterprise',
      content: '不应写入',
    });

    expect(payload(result)).toMatchObject({ success: false, error: '只能访问当前对话自己的 namespace' });
    expect(mocks.getOrCreateStore).not.toHaveBeenCalled();
  });
});
