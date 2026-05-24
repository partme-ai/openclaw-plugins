/**
 * @module nacos/config/merge-deep
 */

import { isPlainObject } from "../shared/shared.js";

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
