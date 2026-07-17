#!/usr/bin/env node
/**
 * 迁移 openclaw.json 中的历史插件 ID。默认只预览，传入 --write 才会备份并写回。
 *
 * Usage: node scripts/migrate-plugin-config-ids.mjs --config /path/to/openclaw.json [--write]
 */

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { migratePluginConfigIds } from "./plugin-config-id-migration.mjs";

const args = process.argv.slice(2);
const configIndex = args.indexOf("--config");
const configArg = configIndex >= 0 ? args[configIndex + 1] : null;
const write = args.includes("--write");

if (!configArg) {
  console.error("Usage: node scripts/migrate-plugin-config-ids.mjs --config /path/to/openclaw.json [--write]");
  process.exit(1);
}

const configPath = resolve(configArg);
const source = JSON.parse(readFileSync(configPath, "utf8"));
const result = migratePluginConfigIds(source);

if (result.conflicts.length > 0) {
  console.error("发现新旧配置冲突，未写入：");
  for (const conflict of result.conflicts) console.error(`- ${conflict}`);
  process.exit(1);
}

if (result.changes.length === 0) {
  console.log("未发现需要迁移的历史插件 ID。");
  process.exit(0);
}

console.log(write ? "准备写入以下迁移：" : "迁移预览（未写入）：");
for (const change of result.changes) console.log(`- ${change}`);

if (write) {
  const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "-");
  const backupPath = `${configPath}.before-plugin-id-migration-${stamp}.bak`;
  copyFileSync(configPath, backupPath);
  writeFileSync(configPath, `${JSON.stringify(result.config, null, 2)}\n`);
  console.log(`备份：${backupPath}`);
  console.log(`已更新：${configPath}`);
}

