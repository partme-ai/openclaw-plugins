/**
 * @module nacos/config/env-expand
 *
 * @fileoverview 展开配置字符串中的 `${VAR}` / `${VAR:default}` 环境变量占位符。
 */
const PLACEHOLDER = /\$\{([^}:]+)(?::([^}]*))?\}/g;

/**
 * 递归展开配置值中的环境变量占位符。
 *
 * @param value - 字符串、数组或对象配置片段
 * @param env - 环境变量表（通常为 `process.env`）
 * @returns 展开后的值（结构与原值一致）
 */
export function expandEnvPlaceholdersInValue(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value === "string") {
    return value.replace(PLACEHOLDER, (_m, name: string, def?: string) => {
      const key = String(name).trim();
      const v = env[key];
      if (v !== undefined && v !== "") {
        return v;
      }
      return def !== undefined ? def : "";
    });
  }
  if (Array.isArray(value)) {
    return value.map((x) => expandEnvPlaceholdersInValue(x, env));
  }
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      out[k] = expandEnvPlaceholdersInValue(v, env);
    }
    return out;
  }
  return value;
}
