#!/usr/bin/env node

import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST_VERSION = "2026.9.6";
const HOST_RANGE = `>=${HOST_VERSION}`;
const NODE_RANGE = ">=24.16.0 <25 || >=26.1.0";
const TEST_NODE = "24.18.0";
const CONTAINER_IMAGE = `node:${TEST_NODE}-bookworm-slim`;

/** Return every host-baseline mismatch without changing the repository. */
export function checkBaseline(repoRoot) {
  const failures = [];
  const read = (relativePath) => {
    try { return readFileSync(join(repoRoot, relativePath), "utf8"); }
    catch (error) {
      failures.push(`${relativePath}: ${error.message}`);
      return null;
    }
  };
  const readJson = (relativePath) => {
    const source = read(relativePath);
    if (source === null) return null;
    try { return JSON.parse(source); }
    catch (error) {
      failures.push(`${relativePath}: invalid JSON (${error.message})`);
      return null;
    }
  };
  const expect = (path, field, actual, required) => {
    if (actual !== required) failures.push(`${path}: ${field} must be ${required}, got ${String(actual)}`);
  };

  const root = readJson("package.json");
  if (root) {
    expect("package.json", "engines.node", root.engines?.node, NODE_RANGE);
    expect("package.json", "devDependencies.openclaw", root.devDependencies?.openclaw, HOST_VERSION);
    expect("package.json", "packageManager", root.packageManager, "pnpm@9.0.0");
  }

  let packageNames = [];
  try {
    packageNames = readdirSync(join(repoRoot, "extensions"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name).sort();
  } catch (error) {
    failures.push(`extensions: ${error.message}`);
  }
  for (const name of packageNames) {
    const path = `extensions/${name}/package.json`;
    const pkg = readJson(path);
    if (!pkg) continue;
    expect(path, "engines.node", pkg.engines?.node, NODE_RANGE);
    if (pkg.devDependencies?.openclaw !== undefined) {
      expect(path, "devDependencies.openclaw", pkg.devDependencies.openclaw, HOST_VERSION);
    }
    expect(path, "peerDependencies.openclaw", pkg.peerDependencies?.openclaw, HOST_RANGE);
    if (pkg.openclaw?.compat?.pluginApi !== undefined) {
      expect(path, "openclaw.compat.pluginApi", pkg.openclaw.compat.pluginApi, HOST_RANGE);
    }
    if (pkg.openclaw?.compat?.minGatewayVersion !== undefined) {
      expect(path, "openclaw.compat.minGatewayVersion", pkg.openclaw.compat.minGatewayVersion, HOST_VERSION);
    }
    for (const field of ["openclawVersion", "pluginSdkVersion"]) {
      if (pkg.openclaw?.build?.[field] !== undefined) {
        expect(path, `openclaw.build.${field}`, pkg.openclaw.build[field], HOST_VERSION);
      }
    }
    if (name !== "message-sdk") {
      expect(path, "openclaw.install.minHostVersion", pkg.openclaw?.install?.minHostVersion, HOST_RANGE);
    }
  }

  for (const path of [".github/workflows/ci.yml", ".github/workflows/build-nacos.yml", ".github/workflows/publish.yml"]) {
    const source = read(path);
    if (source === null) continue;
    const versions = [...source.matchAll(/\bnode-version:\s*['"]?([^\s'"#]+)/g)].map((match) => match[1]);
    if (versions.length === 0) failures.push(`${path}: missing node-version`);
    for (const version of versions) expect(path, "node-version", version, TEST_NODE);
  }
  const composePath = "scripts/e2e/docker-compose.yml";
  const compose = read(composePath);
  if (compose !== null) {
    const image = compose.match(/^  openclaw:\s*\n\s+image:\s*([^\s#]+)/m)?.[1];
    expect(composePath, "openclaw.image", image, CONTAINER_IMAGE);
  }
  return failures;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  const failures = checkBaseline(resolve(import.meta.dirname, ".."));
  if (failures.length) {
    console.error(`OpenClaw baseline failed with ${failures.length} issue(s):\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`OpenClaw ${HOST_VERSION} baseline passed (Node ${TEST_NODE}, pnpm 9.0.0).`);
  }
}
