#!/usr/bin/env node
/**
 * publish-changed.mjs — Publish plugins whose version differs from npm.
 *
 * Strategy:
 *   1. For each plugin, check npm registry for the latest version
 *   2. Compare with local package.json version using numeric semver ordering
 *   3. If local > npm (or not published yet), publish
 *   4. Refuse to publish prerelease (x.y.z-w) with tag "latest"
 *   5. Temporarily materialize workspace: deps → npm semver for publish, then restore
 *
 * Usage:
 *   node scripts/publish-changed.mjs [--dry-run] [--plugin wecom] [--tag next]
 *   node scripts/publish-changed.mjs --dry-run           # preview only
 *   node scripts/publish-changed.mjs --plugin wecom      # single plugin
 *   node scripts/publish-changed.mjs --tag next          # use next dist-tag
 */

import { execSync } from "child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  materializePkgJsonForPublish,
  readMessageSdkVersion,
} from "./workspace-deps.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const PLUGINS_DIR = resolve(ROOT, "extensions");

// ── Version parsing (ported from openclaw-china release scripts) ──

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[.-](\d+))?$/);
  if (!match) throw new Error(`Invalid version: ${version}`);
  const [, majorRaw, minorRaw, patchRaw, revisionRaw] = match;
  return {
    major: Number(majorRaw),
    minor: Number(minorRaw),
    patch: Number(patchRaw),
    revision: revisionRaw === undefined ? 0 : Number(revisionRaw),
    hasRevision: revisionRaw !== undefined,
  };
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // Stable releases (x.y.z) sort AFTER prereleases (x.y.z-w) with same triple
  if (a.hasRevision !== b.hasRevision) return a.hasRevision ? -1 : 1;
  return a.revision - b.revision;
}

// ── Helpers ──

function getPlugins(filterName) {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
    .filter((d) => !filterName || d.name === filterName)
    .map((d) => ({ dir: d.name, path: resolve(PLUGINS_DIR, d.name) }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

function readPkg(pluginPath) {
  return JSON.parse(readFileSync(resolve(pluginPath, "package.json"), "utf8"));
}

function getLatestNpmVersion(packageName) {
  // Query all versions, pick the semantically highest
  try {
    const result = execSync(
      `npm view "${packageName}" versions --json`,
      { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    if (!result) return null;
    const versions = JSON.parse(result);
    const list = Array.isArray(versions) ? versions : [versions];
    if (list.length === 0) return null;
    let latest = null;
    let latestParsed = null;
    for (const v of list) {
      let parsed;
      try { parsed = parseVersion(v); } catch { continue; }
      if (!latestParsed || compareVersions(parsed, latestParsed) > 0) {
        latest = v;
        latestParsed = parsed;
      }
    }
    return latest;
  } catch (e) {
    const stderr = e?.stderr?.toString?.() ?? "";
    if (stderr.includes("E404") || stderr.includes("Not found") || e.status !== 0) return null;
    throw e;
  }
}

function shouldPublish(localVersion, npmVersion) {
  if (!npmVersion) return { reason: "not published yet", publish: true, action: "publish" };

  let localParsed, npmParsed;
  try {
    localParsed = parseVersion(localVersion);
    npmParsed = parseVersion(npmVersion);
  } catch {
    // Can't parse — fall back to string comparison
    if (localVersion !== npmVersion) return { reason: `local=${localVersion} npm=${npmVersion}`, publish: true, action: "publish" };
    return { reason: `up to date (${npmVersion})`, publish: false, action: "skip" };
  }

  const cmp = compareVersions(localParsed, npmParsed);
  if (cmp > 0) {
    return { reason: `local=${localVersion} > npm=${npmVersion}`, publish: true, action: "publish", localParsed, npmParsed };
  }
  if (cmp < 0) {
    return { reason: `SKIPPED: local=${localVersion} is behind npm=${npmVersion}`, publish: false, action: "behind", localParsed, npmParsed };
  }
  return { reason: `up to date (${npmVersion})`, publish: false, action: "skip" };
}

// ── Main ──

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const pluginIdx = args.indexOf("--plugin");
const filterName = pluginIdx >= 0 ? args[pluginIdx + 1] : null;
const tagIdx = args.indexOf("--tag");
const tag = tagIdx >= 0 ? args[tagIdx + 1] : "latest";

if (tag !== "latest" && tag !== "next") {
  console.error(`Invalid tag: "${tag}". Use "latest" or "next".`);
  process.exit(1);
}

console.log(dryRun ? "🔍 DRY RUN — no packages will be published\n" : `📦 Publishing changed plugins (tag: ${tag})...\n`);

const plugins = getPlugins(filterName);
const results = [];
const messageSdkVersion = readMessageSdkVersion();

for (const { dir, path: pluginPath } of plugins) {
  const pkgPath = resolve(pluginPath, "package.json");
  if (!existsSync(pkgPath)) {
    console.log(`⏭️  ${dir} — no package.json, skipped`);
    continue;
  }
  const pkg = readPkg(pluginPath);
  if (pkg.private) {
    console.log(`⏭️  ${dir} — private, skipped`);
    continue;
  }

  const npmVersion = getLatestNpmVersion(pkg.name);
  const { reason, publish, action, localParsed } = shouldPublish(pkg.version, npmVersion);

  // Prerelease protection: refuse x.y.z-w with tag "latest"
  if (publish && localParsed?.hasRevision && tag === "latest") {
    console.log(`⛔ ${dir} — ${pkg.name}@${pkg.version} is prerelease, refusing --tag latest. Use --tag next.`);
    results.push({ plugin: dir, status: "blocked", reason: "prerelease with tag latest" });
    continue;
  }

  if (publish) {
    console.log(`📤 ${dir} — ${pkg.name}@${pkg.version} (${reason})`);
    if (!dryRun) {
      const pkgPath = resolve(pluginPath, "package.json");
      const originalPkgContent = readFileSync(pkgPath, "utf8");
      let materialized = false;
      try {
        const { pkg: publishPkg, changed } = materializePkgJsonForPublish(
          JSON.parse(originalPkgContent),
          messageSdkVersion,
        );
        if (changed) {
          writeFileSync(pkgPath, `${JSON.stringify(publishPkg, null, 2)}\n`);
          materialized = true;
          console.log(
            `  ↳ workspace → ^${messageSdkVersion} (@partme.ai/openclaw-message-sdk) for npm publish`,
          );
        }
        execSync(`cd "${pluginPath}" && npm publish --access public --tag ${tag}`, {
          stdio: "inherit",
          timeout: 120_000,
        });
        results.push({ plugin: dir, status: "published", version: pkg.version });
      } catch (err) {
        console.error(`❌ ${dir} publish failed: ${err.message}`);
        results.push({ plugin: dir, status: "failed", error: err.message });
      } finally {
        if (materialized) {
          writeFileSync(pkgPath, originalPkgContent);
        }
      }
    } else {
      const { changed } = materializePkgJsonForPublish(pkg, messageSdkVersion);
      if (changed) {
        console.log(
          `  ↳ would materialize workspace → ^${messageSdkVersion} (@partme.ai/openclaw-message-sdk)`,
        );
      }
      results.push({ plugin: dir, status: "would-publish", version: pkg.version });
    }
  } else {
    const icon = action === "behind" ? "⚠️" : "✅";
    console.log(`${icon}  ${dir} — ${reason}`);
    results.push({ plugin: dir, status: "skipped", reason });
  }
}

// Summary
console.log(`\n${"─".repeat(50)}`);
const published = results.filter((r) => r.status === "published" || r.status === "would-publish");
const skipped = results.filter((r) => r.status === "skipped");
const blocked = results.filter((r) => r.status === "blocked");
const failed = results.filter((r) => r.status === "failed");

console.log(`Total: ${results.length} | Publish: ${published.length} | Skip: ${skipped.length} | Blocked: ${blocked.length} | Failed: ${failed.length}`);
if (published.length > 0) {
  console.log("\nPublish:");
  for (const r of published) console.log(`  @partme.ai/${r.plugin}@${r.version}`);
}
if (blocked.length > 0) {
  console.log("\nBlocked (use --tag next for prereleases):");
  for (const r of blocked) console.log(`  ${r.plugin}: ${r.reason}`);
}
if (failed.length > 0) {
  console.log("\nFailed:");
  for (const r of failed) console.log(`  ${r.plugin}: ${r.error}`);
  process.exit(1);
}
