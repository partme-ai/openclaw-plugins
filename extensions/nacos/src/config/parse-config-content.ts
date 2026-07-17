/**
 * @fileoverview 解析 Nacos Config Center 下发的 JSON/YAML 配置正文。
 *
 * @module nacos/config/parse-config-content
 */

import { parse as parseYaml } from "yaml";

/** 单条 Nacos 配置正文上限，避免误发布大文件拖垮 Gateway。 */
const MAX_CONFIG_BODY_BYTES = 2 * 1024 * 1024;
/** 配置树深度上限；正常 OpenClaw 配置通常远低于该值。 */
const MAX_CONFIG_DEPTH = 64;
/** 数组元素与对象属性的总量上限。 */
const MAX_CONFIG_ENTRIES = 100_000;
/** 这些键进入后续深合并流程时可能改变对象原型或构造器。 */
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * 对解析结果执行与格式无关的资源和对象安全校验。
 *
 * JSON 与 YAML 最终都会进入同一个深合并和落盘流程，所以不能只约束 YAML parser；
 * 这里统一拒绝循环引用、超深配置、超大集合和原型污染键。
 */
function assertSafeConfigTree(root: unknown): void {
  let entries = 0;
  const active = new WeakSet<object>();

  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_CONFIG_DEPTH) {
      throw new Error(`Nacos config exceeds maximum depth ${MAX_CONFIG_DEPTH}`);
    }
    if (value === null || typeof value !== "object") {
      return;
    }
    if (active.has(value)) {
      throw new Error("Nacos config must not contain circular aliases");
    }

    active.add(value);
    const children = Array.isArray(value)
      ? value.map((item, index) => [String(index), item] as const)
      : Object.entries(value as Record<string, unknown>);
    entries += children.length;
    if (entries > MAX_CONFIG_ENTRIES) {
      throw new Error(`Nacos config exceeds maximum entries ${MAX_CONFIG_ENTRIES}`);
    }
    for (const [key, child] of children) {
      if (!Array.isArray(value) && UNSAFE_KEYS.has(key)) {
        throw new Error(`Nacos config contains unsafe key: ${key}`);
      }
      visit(child, depth + 1);
    }
    active.delete(value);
  };

  visit(root, 0);
}

/**
 * 按 dataId 后缀与内容形态解析 Nacos 配置体为 JS 对象。
 *
 * @param content - 原始配置字符串
 * @param dataId - Nacos dataId（用于推断 YAML）
 * @returns 解析后的 JSON/YAML 对象
 */
export function parseConfigBody(content: string, dataId: string): unknown {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_CONFIG_BODY_BYTES) {
    throw new Error(`Nacos config ${dataId} exceeds ${MAX_CONFIG_BODY_BYTES} bytes`);
  }

  const trimmed = content.trim();
  const lower = dataId.toLowerCase();
  let parsed: unknown;
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
    parsed = parseYaml(trimmed, { maxAliasCount: 50, uniqueKeys: true });
  } else if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    parsed = JSON.parse(trimmed) as unknown;
  } else {
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      parsed = parseYaml(trimmed, { maxAliasCount: 50, uniqueKeys: true });
    }
  }
  assertSafeConfigTree(parsed);
  return parsed;
}
