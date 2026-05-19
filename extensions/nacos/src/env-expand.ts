/**
 * Expands `${VAR}` and `${VAR:default}` in string leaves using `process.env`-style lookup.
 */
const PLACEHOLDER = /\$\{([^}:]+)(?::([^}]*))?\}/g;

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
