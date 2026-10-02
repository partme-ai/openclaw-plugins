import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileContextBudgetProfile } from './check-context-budget.mjs';
test('profile generates usable per-plugin opt-in configurations', () => {
  assert.deepEqual(compileContextBudgetProfile({ totalTokens: 100, allocations: { knowledge: 40, memory: 40, bridge: 20 } }, ['knowledge', 'memory', 'bridge']), {
    plugins: { entries: { knowledge: { config: { contextMaxTokens: 40 } }, memory: { config: { contextMaxTokens: 40 } }, bridge: { config: { contextMaxTokens: 20 } } } },
  });
  assert.throws(() => compileContextBudgetProfile({ totalTokens: 100, allocations: { knowledge: 40, memory: 40, bridge: 21 } }, ['knowledge', 'memory', 'bridge']));
  assert.throws(() => compileContextBudgetProfile({ totalTokens: 100, allocations: { knowledge: 40 } }, ['memory']));
});
