#!/usr/bin/env node
/**
 * ci-detect.mjs — Detect which plugins changed for CI/CD matrix builds.
 *
 * Outputs a JSON array of changed plugin directories, suitable for
 * GitHub Actions matrix strategy. Falls back to all plugins on full runs.
 *
 * Usage:
 *   node scripts/ci-detect.mjs [--all] [--base origin/main]
 *   node scripts/ci-detect.mjs --json     # JSON array output
 *   node scripts/ci-detect.mjs            # human-readable
 */

import { execSync } from "child_process";
import { readdirSync, existsSync } from "fs";
import { resolve, relative, dirname } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const PLUGINS_DIR = resolve(ROOT, "plugins");

function getPluginDirs() {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

function getChangedFiles(base = "origin/main") {
  try {
    const output = execSync(
      `git diff --name-only ${base}...HEAD`,
      { cwd: ROOT, encoding: "utf8" }
    ).trim();
    return output ? output.split("\n") : [];
  } catch {
    // No remote tracking branch yet — treat as "all changed"
    return null;
  }
}

function resolvePluginFromPath(filePath) {
  if (filePath.startsWith("extensions/")) {
    const parts = filePath.split("/");
    if (parts.length >= 2) return parts[1];
  }
  // Root config changes affect all plugins
  if (["package.json", "pnpm-workspace.yaml", "tsconfig.base.json"].includes(filePath)) {
    return "__ALL__";
  }
  return null;
}

function detectChangedPlugins(base) {
  const changedFiles = getChangedFiles(base);
  if (changedFiles === null) {
    // No remote tracking — return all plugins
    return getPluginDirs();
  }

  const affected = new Set();
  let allPlugins = false;

  for (const file of changedFiles) {
    const plugin = resolvePluginFromPath(file);
    if (plugin === "__ALL__") {
      allPlugins = true;
      break;
    }
    if (plugin && existsSync(resolve(PLUGINS_DIR, plugin))) {
      affected.add(plugin);
    }
  }

  if (allPlugins) return getPluginDirs();
  return [...affected].sort();
}

// ── Main ──

const args = process.argv.slice(2);
const useAll = args.includes("--all");
const jsonOutput = args.includes("--json");
const baseIdx = args.indexOf("--base");
const base = baseIdx >= 0 ? args[baseIdx + 1] : "origin/main";

const plugins = useAll ? getPluginDirs() : detectChangedPlugins(base);

if (jsonOutput) {
  console.log(JSON.stringify(plugins));
} else {
  console.log(`Changed plugins (${plugins.length}):`);
  for (const p of plugins) console.log(`  - ${p}`);
}
