import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkReports, readCandidateManifest, validateEvidence } from "./check-e2e-evidence.mjs";

const SHA = "a".repeat(64);
const baseline = () => ({
  report: {
    host: { version: "2026.9.6", nodeVersion: "v24.18.0", cliPath: "/real/openclaw" },
    installed: [{ id: "mqtt", version: "1.2.3", artifactSha256: SHA }],
    sourceFingerprints: { mqtt: "source-a" },
    e2e: [{ plugin: "mqtt", result: "PASS" }],
    browser: [{ plugin: "mqtt", result: "PASS" }],
    skipped: [],
    skipCount: 0,
    skipInstall: false,
    skipBrowser: false,
  },
  expected: {
    hostVersion: "2026.9.6",
    nodeVersion: "v24.18.0",
    sourceFingerprints: { mqtt: "source-a" },
    candidates: { mqtt: { version: "1.2.3", artifactSha256: SHA } },
    currentVersions: { mqtt: "1.2.3" },
    browserPlugins: ["mqtt"],
  },
});

test("candidate and runtime evidence pass only when independently matched", () => {
  const { report, expected } = baseline();
  assert.deepEqual(validateEvidence(report, expected), []);
});

test("single-field tampering of host, plugin, tarball, source, browser and skip is rejected", () => {
  const mutations = [
    (r) => { r.host.version = "2026.7.1"; },
    (r) => { r.host.nodeVersion = "v22.0.0"; },
    (r) => { r.installed[0].version = "2026.9.6"; },
    (r) => { r.installed[0].artifactSha256 = "b".repeat(64); },
    (r) => { r.sourceFingerprints.mqtt = "source-b"; },
    (r) => { r.browser[0].result = "FAIL"; },
    (r) => { r.skipped = ["required test"]; },
    (r) => { r.skipCount = 1; },
  ];
  for (const mutate of mutations) {
    const { report, expected } = baseline();
    mutate(report);
    assert.notDeepEqual(validateEvidence(report, expected), []);
  }
});

test("legacy report has an explicit stale reason", () => {
  const { report, expected } = baseline();
  delete report.host;
  delete report.installed[0].artifactSha256;
  assert.match(validateEvidence(report, expected).join(" "), /stale|legacy/i);
});

test("a FAIL alongside PASS invalidates E2E and browser evidence", () => {
  const { report, expected } = baseline();
  report.e2e.push({ plugin: "mqtt", result: "FAIL" });
  report.browser.push({ plugin: "mqtt", result: "FAIL" });
  assert.match(validateEvidence(report, expected).join(" "), /E2E.*browser|browser.*E2E/);
});

test("archive candidate version must match current package version", () => {
  const { report, expected } = baseline();
  expected.currentVersions.mqtt = "1.2.4";
  assert.match(validateEvidence(report, expected).join(" "), /current package version/);
});

test("unsupported Node major fails even without an exact Node expectation", () => {
  const { report, expected } = baseline();
  delete expected.nodeVersion;
  report.host.nodeVersion = "v25.0.0";
  assert.match(validateEvidence(report, expected).join(" "), /unsupported host Node/);
});

test("candidate manifest verifies the saved tarball independently of the report", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-candidate-"));
  mkdirSync(join(dir, "package"));
  writeFileSync(join(dir, "package/package.json"), JSON.stringify({ name: "@partme.ai/openclaw-mqtt", version: "1.2.3" }));
  const archivePath = join(dir, "run-mqtt.tgz");
  const manifestPath = join(dir, "run.json");
  execFileSync("tar", ["-czf", archivePath, "package"], { cwd: dir });
  const artifactSha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  writeFileSync(manifestPath, JSON.stringify({ candidates: [{ id: "mqtt", version: "1.2.3", artifactSha256, archivePath }] }));
  assert.equal(readCandidateManifest(manifestPath, dir).mqtt.artifactSha256, artifactSha256);
  writeFileSync(archivePath, "changed candidate");
  assert.throws(() => readCandidateManifest(manifestPath, dir), /changed after packing/);
  writeFileSync(manifestPath, "{");
  assert.throws(() => readCandidateManifest(manifestPath, dir), /invalid JSON/);
});

test("manifest and report version tampering cannot override archived package.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-version-tamper-"));
  const pkgDir = join(dir, "package");
  mkdirSync(pkgDir);
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@partme.ai/openclaw-mqtt", version: "1.2.3" }));
  const archivePath = join(dir, "run-mqtt.tgz");
  execFileSync("tar", ["-czf", archivePath, "package"], { cwd: dir });
  const artifactSha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  const manifestPath = join(dir, "run.json");
  writeFileSync(manifestPath, JSON.stringify({ candidates: [{ id: "mqtt", version: "9.9.9", artifactSha256, archivePath }] }));
  assert.throws(() => readCandidateManifest(manifestPath, dir), /version.*archive|archive.*version/);
});

test("malformed report JSON is reported without an uninitialized failure accumulator", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-bad-report-"));
  writeFileSync(join(dir, "bad.json"), "{");
  assert.match(checkReports(dir).join(" "), /bad\.json: invalid JSON/);
});
