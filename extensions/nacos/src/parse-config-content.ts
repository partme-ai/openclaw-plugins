import { parse as parseYaml } from "yaml";

/**
 * Parses Nacos config body as JSON or YAML (when `dataId` ends with `.yml`/`.yaml` or content looks like YAML).
 */
export function parseConfigBody(content: string, dataId: string): unknown {
  const trimmed = content.trim();
  const lower = dataId.toLowerCase();
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
    return parseYaml(trimmed);
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as unknown;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return parseYaml(trimmed);
  }
}
