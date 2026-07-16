#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { EXTENSION_INVENTORY } from "./e2e/lib/registry.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const pluginIndex = args.indexOf("--plugin");
const requestedPlugin = pluginIndex >= 0 ? args[pluginIndex + 1] : undefined;

if (pluginIndex >= 0 && !requestedPlugin) {
  throw new Error("--plugin requires an extension id");
}

const selected = requestedPlugin
  ? EXTENSION_INVENTORY.filter((entry) => entry.id === requestedPlugin)
  : EXTENSION_INVENTORY;
if (selected.length === 0) throw new Error(`Unknown extension: ${requestedPlugin}`);

const workDir = mkdtempSync(join(tmpdir(), "openclaw-plugin-packs-"));

function assertNoWorkspaceDependencies(pkg, id) {
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, specifier] of Object.entries(pkg[section] ?? {})) {
      if (String(specifier).startsWith("workspace:")) {
        throw new Error(`${id}: packed ${section}.${name} still uses ${specifier}`);
      }
    }
  }
}

try {
  for (const entry of selected) {
    const outputDir = join(workDir, entry.id);
    mkdirSync(outputDir, { recursive: true });
    execFileSync(
      "pnpm",
      ["--dir", join(ROOT, entry.dir), "pack", "--pack-destination", outputDir],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const archives = readdirSync(outputDir).filter((name) => name.endsWith(".tgz"));
    if (archives.length !== 1) {
      throw new Error(`${entry.id}: expected one archive, found ${archives.length}`);
    }
    const archive = join(outputDir, archives[0]);
    const members = execFileSync("tar", ["-tf", archive], { encoding: "utf8" }).split("\n");
    if (!members.includes("package/package.json")) throw new Error(`${entry.id}: archive misses package.json`);
    if (!members.some((member) => member.startsWith("package/dist/"))) {
      throw new Error(`${entry.id}: archive misses dist output`);
    }
    if (entry.type !== "sdk" && !members.includes("package/openclaw.plugin.json")) {
      throw new Error(`${entry.id}: archive misses openclaw.plugin.json`);
    }
    const packedPackage = JSON.parse(
      execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" }),
    );
    if (packedPackage.name !== entry.filter) {
      throw new Error(`${entry.id}: packed name ${packedPackage.name} does not match ${entry.filter}`);
    }
    assertNoWorkspaceDependencies(packedPackage, entry.id);
    console.log(`packed ${entry.id}: ${archives[0]}`);
  }
  console.log(`Package archive verification passed for ${selected.length} extension(s).`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
