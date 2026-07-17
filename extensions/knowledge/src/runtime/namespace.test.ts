import { describe, expect, it } from 'vitest';
import { resolveConversationNamespace } from './namespace.js';

describe('resolveConversationNamespace', () => {
  it('derives the same private namespace for Hook and Tool contexts', () => {
    const hook = resolveConversationNamespace({ sessionKey: 'agent:main:wecom:tenant-a:user-1', agentId: 'main' });
    const tool = resolveConversationNamespace({ sessionKey: 'agent:main:wecom:tenant-a:user-1', agentId: 'main' });
    expect(hook).toBe(tool);
    expect(hook).toMatch(/^session-[a-f0-9]{24}:agent$/);
    expect(hook).not.toContain('tenant-a');
  });

  it('separates conversations and preserves the legacy one-shot fallback', () => {
    expect(resolveConversationNamespace({ sessionKey: 'session-a', agentId: 'main' }))
      .not.toBe(resolveConversationNamespace({ sessionKey: 'session-b', agentId: 'main' }));
    expect(resolveConversationNamespace({ agentId: 'main' })).toBe('default:agent');
    expect(resolveConversationNamespace({})).toBe('default:bot');
  });
});
