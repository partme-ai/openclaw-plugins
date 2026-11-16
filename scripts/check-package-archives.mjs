#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { constants, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { checkPackedSdkImports } from "./packed-sdk-imports.mjs";
import { EXTENSION_INVENTORY } from "./e2e/lib/registry.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const host = JSON.parse(readFileSync(join(ROOT, "node_modules/openclaw/package.json"), "utf8"));
const destinationIndex = args.indexOf("--pack-destination");
const destination = destinationIndex < 0 ? undefined : args[destinationIndex + 1];
if (destinationIndex >= 0 && (!destination || destination.startsWith("--"))) {
  throw new Error("--pack-destination requires a directory");
}
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

function checkPackedJavaScriptSyntax(archive, outputDir, id) {
  const unpacked = join(outputDir, "unpacked");
  mkdirSync(unpacked, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", unpacked]);
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && /\.(?:cjs|js|mjs)$/.test(entry.name)) {
        const missing = checkPackedSdkImports(path, readFileSync(path, "utf8"), host.exports);
        if (missing.length) {
          throw new Error(`${id}: ${entry.name} imports unsupported SDK paths on OpenClaw ${host.version}: ${missing.join(", ")}`);
        }
        try {
          execFileSync(process.execPath, ["--check", path], { stdio: ["ignore", "pipe", "pipe"] });
        } catch (error) {
          const diagnostic = error?.stderr?.toString("utf8").trim() || String(error);
          throw new Error(`${id}: packed JavaScript syntax failed in ${path}: ${diagnostic}`);
        }
      }
    }
  };
  visit(join(unpacked, "package", "dist"));
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
    const exportTargets = (entry) => typeof entry === "string" ? [entry]
      : Object.values(entry ?? {}).flatMap(exportTargets);
    const targets = [packedPackage.main, packedPackage.types, ...exportTargets(packedPackage.exports),
      ...(packedPackage.openclaw?.extensions ?? []), packedPackage.openclaw?.setupEntry];
    for (const target of new Set(targets.filter(Boolean))) {
      if (!members.includes("package/" + target.replace(/^\.\//u, ""))) {
        throw new Error(`${entry.id}: declared entry missing from archive: ${target}`);
      }
    }
    assertNoWorkspaceDependencies(packedPackage, entry.id);
    checkPackedJavaScriptSyntax(archive, outputDir, entry.id);
    if (destination) {
      mkdirSync(destination, { recursive: true });
      copyFileSync(archive, join(destination, basename(archive)), constants.COPYFILE_EXCL);
    }
    console.log(`packed ${entry.id}: ${archives[0]}`);
  }
  console.log(`Package archive verification passed for ${selected.length} extension(s).`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
