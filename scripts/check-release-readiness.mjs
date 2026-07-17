#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { readMessageSdkVersion, workspaceSpecifier } from "./workspace-deps.mjs";
import { EXTENSION_INVENTORY, PLUGIN_REGISTRY } from "./e2e/lib/registry.mjs";
import {
  LEGACY_PLUGIN_IDS,
  expectedPackageName,
  isKebabCase,
} from "./plugin-naming.mjs";
import { checkRuntimePluginIds } from "./runtime-plugin-id-contract.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const EXTENSIONS = join(ROOT, "extensions");
const TARGET_OPENCLAW_RANGE = ">=2026.7.1";
const TARGET_RELEASE_VERSION = "2026.7.1";
const SDK_PACKAGE = "@partme.ai/openclaw-message-sdk";
const SDK_VERSION = readMessageSdkVersion();
const SDK_WORKSPACE_SPEC = workspaceSpecifier(SDK_VERSION);
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"];
const errors = [];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function fail(path, message) {
  errors.push(`${path}: ${message}`);
}

const pluginDirs = readdirSync(EXTENSIONS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
  .map((entry) => join(EXTENSIONS, entry.name))
  .sort();
const pluginIds = pluginDirs.map((dir) => basename(dir));
const inventoryIds = EXTENSION_INVENTORY.map((entry) => entry.id).sort();
const e2eInventoryIds = EXTENSION_INVENTORY.filter((entry) => entry.e2eAdapter).map((entry) => entry.id).sort();
const e2eRegistryIds = PLUGIN_REGISTRY.map((entry) => entry.id).sort();

if (JSON.stringify(pluginIds) !== JSON.stringify(inventoryIds)) {
  fail(
    join(ROOT, "scripts/e2e/lib/registry.mjs"),
    `EXTENSION_INVENTORY must exactly match extension directories; directories=${pluginIds.join(",")} inventory=${inventoryIds.join(",")}`,
  );
}
if (JSON.stringify(e2eInventoryIds) !== JSON.stringify(e2eRegistryIds)) {
  fail(
    join(ROOT, "scripts/e2e/lib/registry.mjs"),
    `e2eAdapter flags must exactly match PLUGIN_REGISTRY; flags=${e2eInventoryIds.join(",")} registry=${e2eRegistryIds.join(",")}`,
  );
}

for (const pluginDir of pluginDirs) {
  const id = basename(pluginDir);
  const packagePath = join(pluginDir, "package.json");
  const manifestPath = join(pluginDir, "openclaw.plugin.json");
  const lockPath = join(pluginDir, "pnpm-lock.yaml");

  if (!existsSync(packagePath)) {
    fail(pluginDir, "missing package.json");
    continue;
  }
  const pkg = readJson(packagePath);
  if (!pkg) continue;
  const inventoryEntry = EXTENSION_INVENTORY.find((entry) => entry.id === id);

  if (!pkg.name || !pkg.version) fail(packagePath, "name and version are required");
  if (!isKebabCase(id)) fail(pluginDir, `directory id must be kebab-case, got ${id}`);
  const expectedNpmName = expectedPackageName(id);
  if (pkg.name !== expectedNpmName) {
    fail(packagePath, `package name must follow layered naming policy: ${expectedNpmName}`);
  }
  if (pkg.version !== TARGET_RELEASE_VERSION) {
    fail(packagePath, `version must be ${TARGET_RELEASE_VERSION} for this release, got ${pkg.version}`);
  }
  const publishRegistry = pkg.publishConfig?.registry;
  if (publishRegistry && publishRegistry !== "https://registry.npmjs.org") {
    fail(packagePath, `publishConfig.registry must target npmjs, got ${publishRegistry}`);
  }
  if (inventoryEntry && inventoryEntry.filter !== pkg.name) {
    fail(packagePath, `inventory filter ${inventoryEntry.filter} must match package name ${pkg.name}`);
  }
  if (pkg.private === true) fail(packagePath, "release extension must not be private");
  if (pkg.peerDependencies?.openclaw !== TARGET_OPENCLAW_RANGE) {
    fail(packagePath, `peerDependencies.openclaw must be ${TARGET_OPENCLAW_RANGE}`);
  }
  if (id !== "message-sdk" && (!Array.isArray(pkg.openclaw?.extensions) || pkg.openclaw.extensions.length === 0)) {
    fail(packagePath, "openclaw.extensions must declare at least one runtime entry");
  }
  if (id !== "message-sdk" && pkg.openclaw?.install?.npmSpec !== pkg.name) {
    fail(packagePath, `openclaw.install.npmSpec must match package name ${pkg.name}`);
  }
  if (id !== "message-sdk" && pkg.openclaw?.install?.minHostVersion !== TARGET_OPENCLAW_RANGE) {
    fail(packagePath, `openclaw.install.minHostVersion must be ${TARGET_OPENCLAW_RANGE}`);
  }
  if (pkg.repository?.directory !== `extensions/${id}`) {
    fail(packagePath, `repository.directory must be extensions/${id}`);
  }
  if (pkg.pnpm !== undefined) fail(packagePath, "package-level pnpm configuration is ignored; move it to the workspace root");
  if (typeof pkg.scripts?.lint === "string" && /(?:^|\s)--fix(?:\s|$)/.test(pkg.scripts.lint)) {
    fail(packagePath, "lint must be read-only; move --fix to lint:fix");
  }
  if (!Array.isArray(pkg.files) || !pkg.files.some((entry) => String(entry).replace(/\/$/, "") === "dist")) {
    fail(packagePath, "files must include dist");
  }

  if (!existsSync(manifestPath)) {
    fail(pluginDir, "missing openclaw.plugin.json");
  } else {
    const manifest = readJson(manifestPath);
    if (manifest) {
      if (manifest.id !== id) {
        fail(manifestPath, `id must match extension directory ${id}`);
      }
      if (manifest.version !== pkg.version) {
        fail(manifestPath, `version ${String(manifest.version)} must match package version ${pkg.version}`);
      }
      if (Array.isArray(manifest.channels)) {
        for (const channelId of manifest.channels) {
          if (typeof channelId !== "string" || !isKebabCase(channelId)) {
            fail(manifestPath, `channel id must be kebab-case, got ${String(channelId)}`);
          }
        }
        const declaredChannelId = pkg.openclaw?.channel?.id;
        if (declaredChannelId && !manifest.channels.includes(declaredChannelId)) {
          fail(packagePath, `openclaw.channel.id ${declaredChannelId} must appear in manifest.channels`);
        }
      }
    }
  }

  if (existsSync(lockPath)) fail(lockPath, "plugin-level pnpm-lock.yaml must not be committed");
  for (const legacyManifest of ["clawdbot.plugin.json", "moltbot.plugin.json"]) {
    if (existsSync(join(pluginDir, legacyManifest))) fail(join(pluginDir, legacyManifest), "legacy manifest must be removed");
  }
  for (const entry of readdirSync(pluginDir)) {
    if (entry.endsWith(".tgz")) fail(join(pluginDir, entry), "committed package archive is forbidden");
  }

  for (const section of DEPENDENCY_SECTIONS) {
    const specifier = pkg[section]?.[SDK_PACKAGE];
    if (specifier && specifier !== SDK_WORKSPACE_SPEC) {
      fail(packagePath, `${section}.${SDK_PACKAGE} must be ${SDK_WORKSPACE_SPEC}, got ${specifier}`);
    }
  }
}

for (const [id, legacyIds] of Object.entries(LEGACY_PLUGIN_IDS)) {
  if (!pluginIds.includes(id)) fail(join(ROOT, "scripts/plugin-naming.mjs"), `legacy id owner does not exist: ${id}`);
  for (const legacyId of legacyIds) {
    if (!legacyId || legacyId === id) {
      fail(join(ROOT, "scripts/plugin-naming.mjs"), `invalid legacy id mapping ${legacyId} → ${id}`);
    }
  }
}

const runtimeIdContract = checkRuntimePluginIds();
for (const failure of runtimeIdContract.failures) {
  fail(join(ROOT, "extensions"), `runtime plugin id mismatch: ${failure}`);
}

if (errors.length > 0) {
  console.error(`Release readiness failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Release readiness passed for ${pluginDirs.length} extensions ` +
  `(${runtimeIdContract.checked} runtime IDs, release ${TARGET_RELEASE_VERSION}, ` +
  `OpenClaw ${TARGET_OPENCLAW_RANGE}, message-sdk ${SDK_VERSION}).`,
);
