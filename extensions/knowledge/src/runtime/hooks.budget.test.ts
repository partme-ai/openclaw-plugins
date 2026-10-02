import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerKnowledgeHooks, invalidateStoreCache } from './hooks.js';
import memory, { MemoryStore } from '../../../memory/src/index.js';
import { registerContextInjection } from '../../../bridge/src/bridge/context-inject.js';

const mocks = vi.hoisted(() => ({ search: vi.fn(), embed: vi.fn(async () => [1, 0, 0]) }));
vi.mock('../embedding/factory.js', () => ({ createEmbeddingService: () => ({ embed: mocks.embed, dimensions: 3 }) }));
vi.mock('../store/factory.js', () => ({ getDefaultStoreConfig: () => ({}), createVectorStore: async () => ({ search: mocks.search }) }));
function api(config: Record<string, unknown>) {
  const hooks = new Map<string, Function>();
  let stop = async () => {};
  return { pluginConfig: config, registrationMode: 'full', config: {}, logger: { info() {}, error() {}, warn() {} },
    on: (name: string, fn: Function) => hooks.set(name, fn), registerCli() {}, registerTool() {}, registerMemoryCapability() {},
    registerService: (service: { stop: () => Promise<void> }) => { stop = service.stop; },
    call: (context: unknown = {}) => hooks.get('before_prompt_build')!({ prompt: 'question' }, context), stop: () => stop() };
}
const knowledgeConfig = { enabled: true, embedding: { provider: 'ollama', dimensions: 3 }, retrieval: { strategy: 'vector' }, contextMaxTokens: 40 };
const chunk = { chunk: { id: 'a', metadata: { sourceId: 'doc', text: '中文😀'.repeat(50) } }, score: 1 };
afterEach(async () => { await invalidateStoreCache(); vi.restoreAllMocks(); });
describe('real knowledge + memory + bridge hook composition', () => {
  it('bounds all three injections together, with complete sources and same-source dedup', async () => {
    mocks.search.mockResolvedValue([chunk, { ...chunk, chunk: { ...chunk.chunk, id: 'b', metadata: { ...chunk.chunk.metadata, text: 'duplicate' } } }]);
    vi.spyOn(MemoryStore.prototype, 'initialize').mockResolvedValue();
    vi.spyOn(MemoryStore.prototype, 'createSearchManager').mockReturnValue({ search: async () => [{ snippet: '中文😀'.repeat(50), citation: 'a' }, { snippet: 'duplicate', citation: 'a' }] } as never);
    const k = api(knowledgeConfig), m = api({ contextMaxTokens: 40 }), b = api({ contextMaxTokens: 20, channels: { discord: {} } });
    registerKnowledgeHooks(k as never); memory.register!(m as never); registerContextInjection(b as never);
    const start = performance.now();
    try {
      const results = await Promise.all([k.call({ sessionKey: 'o2' }), m.call({ sessionKey: 'o2' }), b.call({ channel: 'discord' })]);
      const texts = results.map(result => Object.values(result ?? {}).join(''));
      expect(texts.every(Boolean)).toBe(true);
      const counts = texts.map(text => Buffer.byteLength(text));
      expect(counts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100);
      texts.forEach((text, i) => expect(text).toContain(['[knowledge:', '[memory:', '[bridge:'][i]));
      expect(texts.join('')).not.toContain('duplicate');
      console.log(JSON.stringify({ counter: 'utf8-byte-upper-bound-v1', counts, durationMs: performance.now() - start }));
    } finally { await m.stop(); }
  });
  it('deduplicates different chunks sharing the same stable source with space left', async () => {
    mocks.search.mockResolvedValue([
      { ...chunk, chunk: { ...chunk.chunk, metadata: { sourceId: 'doc', text: 'first' } } },
      { ...chunk, chunk: { id: 'b', metadata: { sourceId: 'doc', text: 'duplicate' } } },
      { ...chunk, chunk: { id: 'c', metadata: { sourceId: 'other', text: 'different' } } },
    ]);
    const k = api({ ...knowledgeConfig, contextMaxTokens: 1000 }); registerKnowledgeHooks(k as never);
    const result = await k.call({ sessionKey: 'dedup' });
    expect(result.prependSystemContext).toContain('first');
    expect(result.prependSystemContext).toContain('different');
    expect(result.prependSystemContext).not.toContain('duplicate');
  });
  it('drops retrieval completed after invocation expires and propagates explicit signal', async () => {
    let finish!: (value: unknown) => void;
    mocks.search.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const k = api(knowledgeConfig); registerKnowledgeHooks(k as never);
    let active = true;
    const controller = new AbortController();
    const result = k.call({ sessionKey: 'o2-cancel', signal: controller.signal, hookInvocation: { assertActive() { if (!active) throw Error('expired'); } } });
    await vi.waitFor(() => expect(finish).toBeDefined());
    active = false; controller.abort(); finish([chunk]);
    expect(await result).toBeUndefined();
    expect(mocks.embed).toHaveBeenLastCalledWith('question', controller.signal);
    expect(mocks.search.mock.lastCall?.[1].signal).toBe(controller.signal);
  });
  it('returns no composed context for an already expired invocation', async () => {
    const k = api(knowledgeConfig), m = api({ contextMaxTokens: 40 }), b = api({ contextMaxTokens: 20, channels: { discord: {} } });
    registerKnowledgeHooks(k as never); memory.register!(m as never); registerContextInjection(b as never);
    const ctx = { channel: 'discord', hookInvocation: { assertActive() { throw Error('expired'); } } };
    try { expect(await Promise.all([k.call(ctx), m.call(ctx), b.call(ctx)])).toEqual([undefined, undefined, undefined]); }
    finally { await m.stop(); }
  });
});
