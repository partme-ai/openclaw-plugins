#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateContextBudgetProfile } from '../extensions/message-sdk/src/text/context-budget.ts';

/** 输出待人工合并的配置片段；不修改宿主配置或共享任何运行时总账。 */
export function compileContextBudgetProfile(profile, enabledPlugins) {
  const errors = validateContextBudgetProfile(profile, enabledPlugins);
  if (errors.length) throw new Error(errors.join('; '));
  return { plugins: { entries: Object.fromEntries(enabledPlugins.map(name => [name, { config: { contextMaxTokens: profile.allocations[name] } }])) } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , file, enabled] = process.argv;
    if (!file || !enabled) throw new Error('Usage: node scripts/check-context-budget.mjs profile.json knowledge,memory,bridge');
    console.log(JSON.stringify(compileContextBudgetProfile(JSON.parse(await readFile(file, 'utf8')), enabled.split(',')), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
