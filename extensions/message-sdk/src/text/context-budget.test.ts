import { describe, it, expect } from 'vitest';
import { validateContextBudgetProfile, truncateContextToBudget, countContextTokens, formatBudgetedContext } from './context-budget.js';

describe('composed context budget', () => {
  it('requires complete integer allocations bounded by the total', () => {
    const profile = { totalTokens: 100, allocations: { knowledge: 40, memory: 40, bridge: 20 } };
    expect(validateContextBudgetProfile(profile, ['knowledge', 'memory', 'bridge'])).toEqual([]);
    expect(validateContextBudgetProfile({ ...profile, allocations: { ...profile.allocations, bridge: 21 } }, ['bridge'])).not.toEqual([]);
    for (const profile of [null, {}, { totalTokens: 100, allocations: {} }, { totalTokens: -1, allocations: { memory: 0 } }, { totalTokens: 1, allocations: { memory: 0.5 } }]) {
      expect(validateContextBudgetProfile(profile, ['memory']).length).toBeGreaterThan(0);
    }
  });
  it('counts utf8 bytes conservatively, preserves code points and handles zero', () => {
    expect(countContextTokens('中文😀')).toBe(10);
    for (let budget = 0; budget < 15; budget++) {
      const result = truncateContextToBudget('中文😀hello', budget, countContextTokens);
      expect(countContextTokens(result)).toBeLessThanOrEqual(budget);
      expect(result).not.toMatch(/[\uD800-\uDBFF]$/u);
    }
  });
  it('bounds composed output including intact provenance and removes same-source duplicates', () => {
    const outputs = [['knowledge', 40], ['memory', 40], ['bridge', 20]].map(([plugin, budget]) => formatBudgetedContext(plugin as string, [{ source: 'a', text: '中文😀'.repeat(30) }, { source: 'a', text: 'duplicate' }], budget as number));
    expect(outputs.every(Boolean)).toBe(true);
    expect(outputs.reduce((sum, value) => sum + countContextTokens(value), 0)).toBeLessThanOrEqual(100);
    expect(outputs[0]).toContain('[knowledge:a]');
    expect(outputs.join('')).not.toContain('duplicate');
    expect(formatBudgetedContext('memory', [{ source: 'a', text: 'first' }, { source: 'a', text: 'duplicate' }, { source: 'b', text: 'different' }], 1000)).toBe('[memory:a] first\n[memory:b] different');
    expect(formatBudgetedContext('memory', [{ source: 'long-source', text: 'text' }], 1)).toBe('');
  });
});
