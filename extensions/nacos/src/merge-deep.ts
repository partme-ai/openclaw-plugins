import { isPlainObject } from "./shared.js";

/**
 * Deep-merge plain objects; arrays and primitives from `source` replace `target`.
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
