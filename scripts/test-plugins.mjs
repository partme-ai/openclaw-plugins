#!/usr/bin/env node
/**
 * Unified plugin test runner — unit (Vitest) vs e2e (Docker + gateway) are selectable.
 *
 * Usage:
 *   node scripts/test-plugins.mjs                    # unit + e2e (default: unit only if no docker intent)
 *   node scripts/test-plugins.mjs --unit-only
 *   node scripts/test-plugins.mjs --e2e-only
 *   node scripts/test-plugins.mjs --plugins mqtt,stomp
 *   node scripts/test-plugins.mjs --unit-only --plugins wecom,gotify
 *
 * E2E flags (--keep-services, --skip-browser, …) pass through to run-e2e.mjs.
 */
import { execSync, spawnSync } from "node:child_process";
import {
  EXTENSION_INVENTORY,
  PLUGIN_REGISTRY,
  resolveExtensionIds,
  resolvePlugins,
} from "./e2e/lib/registry.mjs";
import { REPO_ROOT } from "./e2e/lib/utils.mjs";

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{
   *   unitOnly: boolean;
   *   e2eOnly: boolean;
   *   plugins?: string[];
   *   help: boolean;
   *   e2ePassThrough: string[];
   * }} */
  const opts = {
    unitOnly: false,
    e2eOnly: false,
    help: false,
    e2ePassThrough: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--unit-only") opts.unitOnly = true;
    else if (arg === "--e2e-only") opts.e2eOnly = true;
    else if (arg === "--plugins") {
      opts.plugins = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith("--plugins=")) {
      opts.plugins = arg.slice("--plugins=".length).split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      opts.e2ePassThrough.push(arg);
    }
  }

  if (opts.unitOnly && opts.e2eOnly) {
    throw new Error("Use only one of --unit-only or --e2e-only");
  }

  return opts;
}

function printHelp() {
  console.log(`OpenClaw plugin test runner

Usage:
  node scripts/test-plugins.mjs [options] [e2e-options...]

Modes (default: --unit-only when neither flag is set):
  --unit-only     Run Vitest for selected extensions (no Docker)
  --e2e-only      Run scripts/e2e/run-e2e.mjs (Docker + gateway smoke)

Selection:
  --plugins id1,id2   Subset of extensions (default: all in inventory)

E2E options pass through to run-e2e.mjs:
  --keep-services --skip-browser --skip-install

Examples:
  pnpm test:unit
  pnpm test:unit -- --plugins mqtt,stomp
  pnpm test:e2e -- --plugins mqtt,rabbitmq --skip-browser
  pnpm test:plugins -- --unit-only --plugins gotify
`);
}

/**
 * @param {string} filter - pnpm package filter
 */
function runUnitForFilter(filter) {
  console.log(`\n=== unit: ${filter} ===`);
  execSync(`pnpm --filter ${filter} test`, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });
}

/**
 * @param {string[]} extensionIds
 */
function runUnitTests(extensionIds) {
  const selected = EXTENSION_INVENTORY.filter((e) => extensionIds.includes(e.id));
  if (!selected.length) {
    throw new Error(`No extensions matched: ${extensionIds.join(", ")}`);
  }

  console.log("=== OpenClaw plugin unit tests ===");
  console.log("extensions:", selected.map((e) => e.id).join(", "));

  for (const ext of selected) {
    if (!ext.filter) continue;
    runUnitForFilter(ext.filter);
  }
}

/**
 * @param {string[]} e2ePluginIds
 * @param {string[]} passThrough
 */
function runE2eTests(e2ePluginIds, passThrough) {
  const knownE2e = PLUGIN_REGISTRY.map((p) => p.id);
  const unknown = e2ePluginIds.filter((id) => !knownE2e.includes(id));
  if (unknown.length) {
    console.warn(
      `[e2e] Skipping extensions without e2e adapters: ${unknown.join(", ")}. ` +
        `Registered e2e plugins: ${knownE2e.join(", ")}`,
    );
  }
  const runnable = e2ePluginIds.filter((id) => knownE2e.includes(id));
  if (!runnable.length) {
    console.warn("[e2e] No e2e-capable plugins selected; nothing to run.");
    return;
  }

  const args = ["scripts/e2e/run-e2e.mjs", "--plugins", runnable.join(","), ...passThrough];
  console.log("=== OpenClaw plugin e2e ===");
  console.log("$ node", args.join(" "));

  const result = spawnSync("node", args, { cwd: REPO_ROOT, stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const extensionIds = resolveExtensionIds(opts.plugins);
  const runUnit = opts.e2eOnly ? false : true;
  const runE2e = opts.unitOnly ? false : opts.e2eOnly || false;

  // Default: unit-only (Docker e2e is opt-in via --e2e-only or explicit both)
  const unitOnlyDefault = !opts.e2eOnly && !opts.unitOnly;
  const doUnit = runUnit && (opts.unitOnly || unitOnlyDefault);
  const doE2e = runE2e;

  if (doUnit) {
    runUnitTests(extensionIds);
  }

  if (doE2e) {
    const e2eIds = resolvePlugins(
      opts.plugins?.filter((id) => PLUGIN_REGISTRY.some((p) => p.id === id)) ?? undefined,
    );
    runE2eTests(e2eIds, opts.e2ePassThrough);
  }

  if (!doUnit && !doE2e) {
    printHelp();
  }
}

main();
