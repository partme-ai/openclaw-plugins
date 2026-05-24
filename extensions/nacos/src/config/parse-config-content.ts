/**
 * @fileoverview 解析 Nacos Config Center 下发的 JSON/YAML 配置正文。
 *
 * @module nacos/config/parse-config-content
 */

import { parse as parseYaml } from "yaml";

/**
 * 按 dataId 后缀与内容形态解析 Nacos 配置体为 JS 对象。
 *
 * @param content - 原始配置字符串
 * @param dataId - Nacos dataId（用于推断 YAML）
 * @returns 解析后的 JSON/YAML 对象
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
