import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/plugin-entry';
import type { KnowledgeConfig } from '../types.js';
import { createKnowledgeQueryTool } from './knowledge-query.js';
import { authorizeFilePath, authorizeNamespace, defaultNamespace } from './policy.js';

const config: KnowledgeConfig = { enabled: true, tools: {} };
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('knowledge tool policy', () => {
  it('only allows a non-owner to access the current session namespace', () => {
    const ctx = {
      sessionKey: 'agent:main:wecom:tenant-a:user-1',
      agentAccountId: 'acct-a',
      agentId: 'main',
      senderIsOwner: false,
    } satisfies OpenClawPluginToolContext;
    const own = defaultNamespace(ctx);
    expect(own).toMatch(/^session-[a-f0-9]{24}:agent$/);
    expect(authorizeNamespace(ctx, undefined, config)).toEqual({ ok: true, namespace: own });
    expect(authorizeNamespace(ctx, 'session-000000000000000000000000:agent', config)).toEqual({ ok: false, error: '只能访问当前对话自己的 namespace' });
    expect(authorizeNamespace(ctx, 'global', config)).toEqual({ ok: false, error: '只能访问当前对话自己的 namespace' });
  });

  it('allows owner global namespaces unless explicitly disabled', () => {
    const ctx = { agentAccountId: 'acct-a', senderIsOwner: true } satisfies OpenClawPluginToolContext;
    expect(authorizeNamespace(ctx, 'enterprise', config)).toEqual({ ok: true, namespace: 'enterprise' });
    expect(authorizeNamespace(ctx, 'enterprise', { enabled: true, tools: { allowOwnerGlobalNamespaces: false } }).ok).toBe(false);
  });

  it('requires owner, opt-in, and a real path beneath an allowed root', async () => {
    const base = await mkdtemp(join(tmpdir(), 'knowledge-policy-'));
    tempDirs.push(base);
    const root = join(base, 'allowed');
    const outside = join(base, 'outside');
    await mkdir(root);
    await mkdir(outside);
    const allowedFile = join(root, 'doc.md');
    const secretFile = join(outside, 'secret.md');
    await writeFile(allowedFile, 'allowed');
    await writeFile(secretFile, 'secret');
    await symlink(secretFile, join(root, 'link.md'));
    const secured: KnowledgeConfig = {
      enabled: true,
      tools: { allowFileIngest: true, allowedFileRoots: [root] },
    };

    expect((await authorizeFilePath({ senderIsOwner: false }, allowedFile, secured)).ok).toBe(false);
    expect((await authorizeFilePath({ senderIsOwner: true }, allowedFile, config)).ok).toBe(false);
    expect(await authorizeFilePath({ senderIsOwner: true }, allowedFile, secured)).toEqual({
      ok: true,
      filePath: await realpath(allowedFile),
      maxFileBytes: 10 * 1024 * 1024,
    });
    expect((await authorizeFilePath({ senderIsOwner: true }, join(root, 'link.md'), secured)).ok).toBe(false);
  });

  it('rejects cross-account reads before initializing a store', async () => {
    const tool = createKnowledgeQueryTool(
      { agentAccountId: 'acct-a', senderIsOwner: false },
      { enabled: true },
    );
    const result = await tool.execute('call-1', { query: 'secret', namespace: 'acct-b:bot' });
    expect(result.content[0]?.text).toContain('只能访问当前对话自己的 namespace');
  });
});
