#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`;

execSync("pnpm pack", { stdio: "inherit" });

console.log("\n=== Would publish ===");
execSync(`tar tzf "${tarball}"`, { stdio: "inherit" });

import { rmSync } from "node:fs";
rmSync(tarball);
console.log(`\n(removed ${tarball})`);
