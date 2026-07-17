import { describe, expect, it } from 'vitest';
import { safeKnowledgeError } from './safe-error.js';

describe('safeKnowledgeError', () => {
  it('遮蔽 URL 凭据、常见密钥、本机路径和控制字符', () => {
    const result = safeKnowledgeError(new Error(
      'request https://alice:secret@provider.example failed api_key=token-1 ' +
      'at /Users/alice/private/knowledge.db\nAuthorization: Bearer bearer-1',
    ));

    expect(result).toContain('https://[REDACTED]@provider.example');
    expect(result).toContain('api_key=[REDACTED]');
    expect(result).toContain('[PATH]');
    expect(result).not.toMatch(/secret|token-1|bearer-1|\/Users\/alice|\n/u);
  });

  it('遮蔽 JSON 错误正文中的密码字段并限制长度', () => {
    const result = safeKnowledgeError(`{"password":"db-secret","message":"${'x'.repeat(800)}"}`);
    expect(result).toContain('"password":"[REDACTED]"');
    expect(result).not.toContain('db-secret');
    expect(result.length).toBeLessThanOrEqual(500);
  });
});
