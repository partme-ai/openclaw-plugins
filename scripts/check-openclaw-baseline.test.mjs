import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { checkBaseline } from "./check-openclaw-baseline.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "openclaw-baseline-"));
  const write = (path, content) => {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content));
  };
  write("package.json", { engines: { node: ">=24.16.0 <25 || >=26.1.0" }, devDependencies: { openclaw: "2026.9.6" }, packageManager: "pnpm@9.0.0" });
  write("extensions/example/package.json", {
    version: "2026.7.1", engines: { node: ">=24.16.0 <25 || >=26.1.0" },
    devDependencies: { openclaw: "2026.9.6" }, peerDependencies: { openclaw: ">=2026.9.6" },
    openclaw: { compat: { pluginApi: ">=2026.9.6", minGatewayVersion: "2026.9.6" },
      build: { openclawVersion: "2026.9.6", pluginSdkVersion: "2026.9.6" },
      install: { minHostVersion: ">=2026.9.6" } },
  });
  write(".github/workflows/ci.yml", setupNode("24.18.0"));
  write(".github/workflows/build-nacos.yml", setupNode("24.18.0"));
  write(".github/workflows/publish.yml", setupNode("24.18.0"));
  write("scripts/e2e/docker-compose.yml", "  openclaw:\n    image: node:24.18.0-bookworm-slim\n");
  return { root, write, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function setupNode(version) {
  return `jobs:\n  build:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${version}\n`;
}

test("allows a valid candidate plugin version independent of the host", () => {
  const f = fixture();
  try { assert.deepEqual(checkBaseline(f.root), []); } finally { f.cleanup(); }
});

test("rejects Node 22 in package engines and CI", () => {
  const f = fixture();
  try {
    f.write("package.json", { engines: { node: ">=22.0.0" }, devDependencies: { openclaw: "2026.9.6" }, packageManager: "pnpm@9.0.0" });
    f.write(".github/workflows/ci.yml", setupNode("22"));
    assert.match(checkBaseline(f.root).join("\n"), /package\.json.*engines\.node/);
    assert.match(checkBaseline(f.root).join("\n"), /ci\.yml.*node-version/);
  } finally { f.cleanup(); }
});

test("rejects stale compatibility and container image", () => {
  const f = fixture();
  try {
    const pkg = JSON.parse(readFileSync(join(f.root, "extensions/example/package.json"), "utf8"));
    pkg.openclaw.compat.minGatewayVersion = "2026.7.1";
    f.write("extensions/example/package.json", pkg);
    f.write("scripts/e2e/docker-compose.yml", "  openclaw:\n    image: node:22-bookworm-slim\n");
    const failures = checkBaseline(f.root).join("\n");
    assert.match(failures, /minGatewayVersion/);
    assert.match(failures, /docker-compose\.yml.*image/);
  } finally { f.cleanup(); }
});

test("rejects old development, peer, and build host versions", () => {
  const f = fixture();
  try {
    const pkg = JSON.parse(readFileSync(join(f.root, "extensions/example/package.json"), "utf8"));
    pkg.devDependencies.openclaw = "2026.7.1";
    pkg.peerDependencies.openclaw = ">=2026.7.1";
    pkg.openclaw.build.openclawVersion = "2026.7.1";
    f.write("extensions/example/package.json", pkg);
    const failures = checkBaseline(f.root).join("\n");
    assert.match(failures, /devDependencies\.openclaw/);
    assert.match(failures, /peerDependencies\.openclaw/);
    assert.match(failures, /openclaw\.build\.openclawVersion/);
  } finally { f.cleanup(); }
});

test("CLI exits 1 when the repository baseline is stale", () => {
  const f = fixture();
  try {
    f.write(".github/workflows/publish.yml", setupNode("22"));
    mkdirSync(join(f.root, "scripts"), { recursive: true });
    copyFileSync(new URL("./check-openclaw-baseline.mjs", import.meta.url), join(f.root, "scripts/check-openclaw-baseline.mjs"));
    symlinkSync(join(import.meta.dirname, "..", "node_modules"), join(f.root, "node_modules"), "dir");
    assert.throws(
      () => execFileSync(process.execPath, [join(f.root, "scripts/check-openclaw-baseline.mjs")], { encoding: "utf8", stdio: "pipe" }),
      (error) => error.status === 1 && /publish\.yml.*node-version/.test(error.stderr),
    );
  } finally { f.cleanup(); }
});

test("rejects removal of existing compat and build host fields", () => {
  const f = fixture();
  try {
    const pkg = JSON.parse(readFileSync(join(f.root, "extensions/example/package.json"), "utf8"));
    delete pkg.openclaw.compat;
    delete pkg.openclaw.build.pluginSdkVersion;
    f.write("extensions/amap/package.json", pkg);
    const failures = checkBaseline(f.root).join("\n");
    assert.match(failures, /amap\/package\.json.*openclaw\.compat\.pluginApi/);
    assert.match(failures, /amap\/package\.json.*openclaw\.compat\.minGatewayVersion/);
    assert.match(failures, /amap\/package\.json.*openclaw\.build\.pluginSdkVersion/);
  } finally { f.cleanup(); }
});

test("does not accept a commented node-version in a setup-node step", () => {
  const f = fixture();
  try {
    f.write(".github/workflows/ci.yml", "jobs:\n  build:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          # node-version: 24.18.0\n");
    assert.match(checkBaseline(f.root).join("\n"), /ci\.yml.*node-version/);
  } finally { f.cleanup(); }
});

test("rejects valid JSON null for root and extension packages", () => {
  const f = fixture();
  try {
    f.write("package.json", "null\n");
    f.write("extensions/example/package.json", "null\n");
    const failures = checkBaseline(f.root).join("\n");
    assert.match(failures, /package\.json: invalid JSON object/);
    assert.match(failures, /extensions\/example\/package\.json: invalid JSON object/);
  } finally { f.cleanup(); }
});
