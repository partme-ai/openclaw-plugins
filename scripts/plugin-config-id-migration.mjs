import { LEGACY_PLUGIN_IDS } from "./plugin-naming.mjs";

function replaceIds(values, canonicalByLegacy, path, changes) {
  if (!Array.isArray(values)) return values;
  const result = [];
  for (const value of values) {
    const next = typeof value === "string" ? (canonicalByLegacy.get(value) ?? value) : value;
    if (next !== value) changes.push(`${path}: ${value} → ${next}`);
    if (!result.includes(next)) result.push(next);
  }
  return result;
}

/**
 * 将 openclaw.json 中历史插件 ID 迁移为 canonical 短 ID。
 *
 * 同时迁移 plugins.entries、plugins.allow 和 plugins.deny。新旧 entries 同时存在时
 * 拒绝猜测合并优先级，要求管理员先处理冲突。
 */
export function migratePluginConfigIds(config, mappings = LEGACY_PLUGIN_IDS) {
  const next = structuredClone(config);
  const changes = [];
  const conflicts = [];
  const canonicalByLegacy = new Map();
  for (const [canonicalId, legacyIds] of Object.entries(mappings)) {
    for (const legacyId of legacyIds) canonicalByLegacy.set(legacyId, canonicalId);
  }

  const plugins = next?.plugins;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) {
    return { config: next, changes, conflicts };
  }

  const entries = plugins.entries;
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    for (const [legacyId, canonicalId] of canonicalByLegacy) {
      if (!Object.hasOwn(entries, legacyId)) continue;
      if (Object.hasOwn(entries, canonicalId)) {
        conflicts.push(`plugins.entries 同时包含 ${legacyId} 和 ${canonicalId}`);
        continue;
      }
      entries[canonicalId] = entries[legacyId];
      delete entries[legacyId];
      changes.push(`plugins.entries.${legacyId} → plugins.entries.${canonicalId}`);
    }
  }

  plugins.allow = replaceIds(plugins.allow, canonicalByLegacy, "plugins.allow", changes);
  plugins.deny = replaceIds(plugins.deny, canonicalByLegacy, "plugins.deny", changes);
  return { config: next, changes, conflicts };
}

