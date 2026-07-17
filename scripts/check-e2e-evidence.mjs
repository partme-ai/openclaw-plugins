#!/usr/bin/env node

/**
 * 检查每个运行时插件是否拥有与当前源码完全一致的 E2E PASS 归档。
 *
 * 报告中的 Git commit 只能定位提交，无法覆盖未提交工作区；sourceFingerprints 才是当前
 * 候选物与实测候选物一致的证明。旧格式报告会被明确标为 stale，而不是静默放行。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { sourceFingerprint } from "./e2e/lib/evidence.mjs";
import { EXTENSION_INVENTORY } from "./e2e/lib/registry.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const REPORTS_DIR = join(ROOT, "scripts/e2e/reports");
const TARGET_VERSION = "2026.7.1";
const reports = readReports(REPORTS_DIR);
const failures = [];
const accepted = [];

for (const extension of EXTENSION_INVENTORY.filter((entry) => entry.e2eAdapter)) {
  const expected = sourceFingerprint(extension.id, { repoRoot: ROOT });
  const evidence = reports.find((report) =>
    report.e2e?.some((result) => result.plugin === extension.id && result.result === "PASS") &&
    report.sourceFingerprints?.[extension.id] === expected &&
    installedVersion(report, extension.id) === TARGET_VERSION,
  );
  if (evidence) {
    accepted.push({ id: extension.id, finishedAt: evidence.finishedAt, archivePath: evidence.archivePath });
    continue;
  }

  const latestPass = reports.find((report) =>
    report.e2e?.some((result) => result.plugin === extension.id && result.result === "PASS"),
  );
  if (!latestPass) failures.push(`${extension.id}: missing PASS report`);
  else if (!latestPass.sourceFingerprints?.[extension.id]) {
    failures.push(`${extension.id}: latest PASS uses legacy report without source fingerprint`);
  } else if (installedVersion(latestPass, extension.id) !== TARGET_VERSION) {
    failures.push(`${extension.id}: latest matching source was not installed as ${TARGET_VERSION}`);
  } else {
    failures.push(`${extension.id}: source or E2E inputs changed after the latest PASS`);
  }
}

if (failures.length > 0) {
  console.error(`E2E evidence check failed for ${failures.length} plugin(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`E2E evidence is current for ${accepted.length} runtime plugins (OpenClaw ${TARGET_VERSION}).`);
for (const item of accepted) console.log(`- ${item.id}: ${item.finishedAt} (${item.archivePath})`);

function readReports(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        return JSON.parse(readFileSync(join(directory, name), "utf8"));
      } catch (error) {
        failures.push(`${name}: invalid report JSON (${error instanceof Error ? error.message : String(error)})`);
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => String(right.finishedAt ?? "").localeCompare(String(left.finishedAt ?? "")));
}

function installedVersion(report, pluginId) {
  if (!Array.isArray(report.installed)) return undefined;
  const item = report.installed.find((entry) => entry.id === pluginId || entry.plugin === pluginId);
  return item?.version;
}

