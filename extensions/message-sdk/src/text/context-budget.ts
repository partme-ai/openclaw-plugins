/** 插件注入预算：UTF-8 字节上界 v1，覆盖 byte-level tokenizer，非精确 token 用量。 */
export const CONTEXT_TOKEN_COUNTER = 'utf8-byte-upper-bound-v1';
export type ContextBudgetPlugin = 'knowledge' | 'memory' | 'bridge';
export interface ContextBudgetProfile {
  totalTokens: number;
  allocations: Partial<Record<ContextBudgetPlugin, number>>;
}
const plugins = ['knowledge', 'memory', 'bridge'] as const;
const validBudget = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
/** 校验所有分配（含未启用项）的总和，启用项不得缺失。 */
export function validateContextBudgetProfile(profile: unknown, enabledPlugins: readonly string[]): string[] {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return ['profile must be an object'];
  const { totalTokens, allocations } = profile as ContextBudgetProfile;
  const errors: string[] = [];
  if (!validBudget(totalTokens)) errors.push('totalTokens must be a non-negative safe integer');
  if (!allocations || typeof allocations !== 'object' || Array.isArray(allocations)) return [...errors, 'allocations must be an object'];
  let total = 0;
  for (const [name, value] of Object.entries(allocations)) {
    if (!plugins.includes(name as ContextBudgetPlugin)) errors.push(`unknown allocation: ${name}`);
    if (!validBudget(value)) errors.push(`${name} must be a non-negative safe integer`);
    else total += value;
  }
  for (const name of enabledPlugins) {
    if (!plugins.includes(name as ContextBudgetPlugin)) errors.push(`unknown enabled plugin: ${name}`);
    if (!Object.hasOwn(allocations, name)) errors.push(`missing allocation: ${name}`);
  }
  if (total > totalTokens) errors.push('allocations exceed totalTokens');
  return errors;
}
/** 一个 UTF-8 byte 最多对应一个 byte-level token；固定版本用于组合预算测量。 */
export function countContextTokens(text: string): number { return Buffer.byteLength(text, 'utf8'); }
/** 返回完整 Unicode 码点前缀；最终校验确保自定义计数器下也不超限。 */
export function truncateContextToBudget(text: string, maxTokens: number, countTokens: (text: string) => number): string {
  if (!validBudget(maxTokens)) throw new Error('contextMaxTokens must be a non-negative safe integer');
  if (maxTokens === 0) return '';
  if (countTokens(text) <= maxTokens) return text;
  const points = Array.from(text);
  let low = 0, high = points.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (countTokens(points.slice(0, mid).join('')) <= maxTokens) low = mid;
    else high = mid - 1;
  }
  const result = points.slice(0, low).join('');
  return countTokens(result) <= maxTokens ? result : '';
}
/** 为每个来源保留首条结果，标签不截断；不足以容纳标签及正文时不注入。 */
export function formatBudgetedContext(plugin: string, fragments: readonly { source: string; text: string }[], maxTokens: number): string {
  truncateContextToBudget('', maxTokens, countContextTokens);
  const seen = new Set<string>();
  let output = '';
  for (const fragment of fragments) {
    if (seen.has(fragment.source)) continue;
    seen.add(fragment.source);
    const prefix = `${output ? '\n' : ''}[${plugin}:${encodeURIComponent(fragment.source).replaceAll('%2F', '/')}] `;
    const available = maxTokens - countContextTokens(output + prefix);
    if (available <= 0) continue;
    const body = truncateContextToBudget(fragment.text, available, countContextTokens);
    if (body) output += prefix + body;
  }
  return output;
}
/** 宿主只暴露 assertActive 时仍可阻止过期注入；显式 signal 同时检查。 */
export function isContextInvocationActive(context: unknown): boolean {
  const ctx = context as { signal?: AbortSignal; hookInvocation?: { assertActive(): void } } | undefined;
  try { ctx?.signal?.throwIfAborted(); ctx?.hookInvocation?.assertActive(); return true; }
  catch { return false; }
}
