#!/usr/bin/env node
/**
 * Pack dry-run: materialize workspace deps, pack, verify tarball contents,
 * and fail if any workspace: protocol leaks into the published manifest.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  materializePkgJsonForPublish,
  readMessageSdkVersion,
} from "../../../scripts/workspace-deps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, "..");
const pkgPath = resolve(pluginRoot, "package.json");
const originalPkgContent = readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(originalPkgContent);
const sdkVersion = readMessageSdkVersion();
const { pkg: publishPkg, changed } = materializePkgJsonForPublish(pkg, sdkVersion);

if (changed) {
  writeFileSync(pkgPath, `${JSON.stringify(publishPkg, null, 2)}\n`);
}

try {
  const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`;

  execSync("pnpm pack", { cwd: pluginRoot, stdio: "inherit" });

  console.log("\n=== Tarball contents ===");
  execSync(`tar tzf "${tarball}"`, { cwd: pluginRoot, stdio: "inherit" });

  const manifestRaw = execSync(`tar xOf "${tarball}" package/package.json`, {
    cwd: pluginRoot,
    encoding: "utf8",
  });
  const manifest = JSON.parse(manifestRaw);
  const deps = JSON.stringify(manifest.dependencies ?? {});
  if (deps.includes("workspace:")) {
    console.error("\nERROR: packed package.json still contains workspace: dependencies");
    console.error(deps);
    process.exit(1);
  }

  if (!manifest.openclaw?.extensions?.length) {
    console.error("\nERROR: packed package.json missing openclaw.extensions");
    process.exit(1);
  }

  console.log("\n=== Publish manifest dependencies ===");
  console.log(JSON.stringify(manifest.dependencies, null, 2));
  console.log("\nOK: tarball is publish-ready");

  rmSync(resolve(pluginRoot, tarball));
  console.log(`\n(removed ${tarball})`);
} finally {
  writeFileSync(pkgPath, originalPkgContent);
}
