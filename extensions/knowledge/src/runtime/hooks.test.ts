import { describe, expect, it, vi } from 'vitest';
import { registerKnowledgeHooks } from './hooks.js';

describe('registerKnowledgeHooks', () => {
  it('fails closed for invalid runtime config with the official Hook context shape', async () => {
    let hook: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const api = {
      pluginConfig: {},
      config: {},
      logger,
      on: (name: string, callback: typeof hook) => {
        if (name === 'before_prompt_build') hook = callback;
      },
    };
    const config = {
      enabled: true,
      embedding: { provider: 'ollama', dimensions: 3 },
      retrieval: { topK: 0 },
    };

    registerKnowledgeHooks(api as never, undefined, config as never);
    await expect(hook?.(
      { prompt: '如何使用知识库？', messages: [] },
      { sessionKey: 'agent:main:wecom:tenant:user', agentId: 'main', messageProvider: 'wecom' },
    )).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('retrieval.topK'));
  });
});
