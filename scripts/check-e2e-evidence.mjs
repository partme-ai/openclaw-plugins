#!/usr/bin/env node
/** Validate installed E2E evidence against current source and packed candidate archives. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFingerprint } from "./e2e/lib/evidence.mjs";
import { EXTENSION_INVENTORY, findExtension } from "./e2e/lib/registry.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const REPORTS_DIR = join(ROOT, "scripts/e2e/reports");
const HOST_VERSION = "2026.9.6";

/** Pure contract check; expected is supplied by current source and the packer's candidate manifest. */
export function validateEvidence(report, expected) {
  const failures = [];
  if (!report || typeof report !== "object") return ["stale: missing report"];
  if (!report.host?.version || !report.host?.cliPath || !report.host?.nodeVersion) failures.push("stale: legacy report lacks actual host baseline");
  else {
    if (report.host.version !== expected.hostVersion) failures.push("host version mismatch");
    if (expected.nodeVersion && report.host.nodeVersion !== expected.nodeVersion) failures.push("host Node version mismatch");
    const nodeMatch = /^v(\d+)\.(\d+)\.(\d+)$/.exec(report.host.nodeVersion);
    const nodeSupported = nodeMatch && ((Number(nodeMatch[1]) === 24 && (Number(nodeMatch[2]) > 16 || (Number(nodeMatch[2]) === 16 && Number(nodeMatch[3]) >= 0))) ||
      (Number(nodeMatch[1]) > 26 || (Number(nodeMatch[1]) === 26 && Number(nodeMatch[2]) >= 1)));
    if (!nodeSupported) failures.push("unsupported host Node version");
  }
  if (report.skipInstall || report.skipBrowser || !Array.isArray(report.skipped) || report.skipped.length > 0 || report.skipCount !== 0) failures.push("required tests or install skipped");
  for (const [id, fingerprint] of Object.entries(expected.sourceFingerprints ?? {})) {
    if (report.sourceFingerprints?.[id] !== fingerprint) failures.push(`${id}: source or E2E inputs changed`);
    const candidate = expected.candidates?.[id];
    if (!candidate?.version || !/^[a-f0-9]{64}$/.test(candidate.artifactSha256 ?? "")) {
      failures.push(`${id}: trusted candidate artifact missing`);
      continue;
    }
    if (expected.currentVersions?.[id] && candidate.version !== expected.currentVersions[id]) failures.push(`${id}: candidate differs from current package version`);
    const installed = Array.isArray(report.installed)
      ? report.installed.find((entry) => entry?.id === id || entry?.plugin === id)
      : undefined;
    if (!installed?.artifactSha256) failures.push(`${id}: stale legacy report lacks artifact SHA-256`);
    if (installed?.version !== candidate.version) failures.push(`${id}: installed plugin version mismatch`);
    if (installed?.artifactSha256 !== candidate.artifactSha256) failures.push(`${id}: installed tarball SHA-256 mismatch`);
    const e2eResults = Array.isArray(report.e2e) ? report.e2e.filter((result) => result?.plugin === id) : [];
    if (e2eResults.length !== 1 || e2eResults[0].result !== "PASS") failures.push(`${id}: E2E results are not exactly one PASS`);
    if (expected.browserPlugins?.includes(id)) {
      const browserResults = Array.isArray(report.browser) ? report.browser.filter((result) => result?.plugin === id) : [];
      if (browserResults.length !== 1 || browserResults[0].result !== "PASS") failures.push(`${id}: browser results are not exactly one PASS`);
    }
  }
  return failures;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(`invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}

/** Reject manifests outside the ignored candidate archive and verify every saved tarball. */
export function readCandidateManifest(path, candidateDir = join(REPORTS_DIR, "candidates")) {
  const trustedDir = realpathSync(candidateDir);
  const absolute = realpathSync(path);
  const suffix = relative(trustedDir, absolute);
  if (!suffix || suffix.startsWith("..") || isAbsolute(suffix) || !suffix.endsWith(".json")) throw new Error("candidate manifest outside trusted pack output");
  const manifest = readJson(absolute);
  const candidates = Object.create(null);
  for (const item of manifest.candidates ?? []) {
    const archive = realpathSync(item.archivePath ?? "");
    const archiveSuffix = relative(trustedDir, archive);
    if (!archiveSuffix || archiveSuffix.startsWith("..") || isAbsolute(archiveSuffix) || !archiveSuffix.endsWith(".tgz")) throw new Error(`${item.id}: candidate tarball outside pack output`);
    const runId = absolute.slice(trustedDir.length + 1, -".json".length);
    if (runId.includes("/") || archiveSuffix !== `${runId}-${item.id}.tgz`) throw new Error(`${item.id}: candidate archive does not match pack run identity`);
    const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
    if (digest !== item.artifactSha256) throw new Error(`${item.id}: candidate archive changed after packing`);
    let packageJson;
    try { packageJson = JSON.parse(execFileSync("tar", ["-xOzf", archive, "package/package.json"], { encoding: "utf8" })); }
    catch { throw new Error(`${item.id}: candidate archive lacks readable package.json`); }
    if (packageJson.name !== findExtension(item.id).filter) throw new Error(`${item.id}: package name differs from registered candidate`);
    if (packageJson.version !== item.version) throw new Error(`${item.id}: manifest version differs from archive package version`);
    if (candidates[item.id]) throw new Error(`${item.id}: duplicate candidate in manifest`);
    candidates[item.id] = { version: item.version, artifactSha256: digest };
  }
  return candidates;
}

export function checkReports(directory = REPORTS_DIR) {
  const reports = [];
  const failures = [];
  if (existsSync(directory)) for (const name of readdirSync(directory).filter((n) => n.endsWith(".json"))) {
    try { reports.push(readJson(join(directory, name))); }
    catch (error) { failures.push(`${name}: ${error.message}`); }
  }
  reports.sort((a, b) => String(b.finishedAt ?? "").localeCompare(String(a.finishedAt ?? "")));
  for (const extension of EXTENSION_INVENTORY.filter((entry) => entry.e2eAdapter)) {
    const id = extension.id;
    const fingerprint = sourceFingerprint(id, { repoRoot: ROOT });
    const candidates = reports.filter((report) => Array.isArray(report?.plugins) && report.plugins.includes(id));
    let reason = "missing report";
    let accepted = false;
    for (const report of candidates) {
      try {
        const packed = report.candidateManifest ? readCandidateManifest(report.candidateManifest) : {};
        const currentVersion = readJson(join(ROOT, extension.dir, "package.json")).version;
        const issues = validateEvidence(report, { hostVersion: HOST_VERSION, sourceFingerprints: { [id]: fingerprint }, candidates: packed, currentVersions: { [id]: currentVersion }, browserPlugins: extension.browserTest ? [id] : [] });
        if (issues.length === 0) { accepted = true; break; }
        reason = issues.join("; ");
      } catch (error) { reason = error.message; }
    }
    if (!accepted) failures.push(`${id}: ${reason}`);
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkReports();
  if (failures.length) {
    console.error(`E2E evidence check failed for ${failures.length} issue(s):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else console.log(`E2E evidence is current for ${EXTENSION_INVENTORY.filter((entry) => entry.e2eAdapter).length} runtime plugins (OpenClaw ${HOST_VERSION}).`);
}
