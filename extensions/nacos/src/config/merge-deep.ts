/**
 * @module nacos/config/merge-deep
 */

import { isPlainObject } from "../shared/shared.js";

const UNSAFE_MERGE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * 深合并可能把远端对象复制进长期运行的 OpenClaw 配置树，因此在合并前递归检查所有键。
 * 即使危险键位于一个将被整体替换的子对象中，也不能让它绕过检查。
 */
function assertSafeMergeKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertSafeMergeKeys(item);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_MERGE_KEYS.has(key)) {
      throw new Error(`Cannot merge unsafe key: ${key}`);
    }
    assertSafeMergeKeys(child);
  }
}

/**
 * Deep-merge plain objects; arrays and primitives from `source` replace `target`.
 *
 * @param target - 基础对象（不被 mutate，返回新对象）
 * @param source - 覆盖层；undefined 键被跳过
 * @returns 合并后的新对象
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  assertSafeMergeKeys(source);
  const out = { ...target } as Record<string, unknown>;
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
