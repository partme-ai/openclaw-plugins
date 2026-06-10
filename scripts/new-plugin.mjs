#!/usr/bin/env node
/**
 * new-plugin.mjs — Generate a new plugin from _template (Base Profile).
 *
 * Usage:
 *   node scripts/new-plugin.mjs my-plugin
 *   node scripts/new-plugin.mjs my-plugin --label "My Plugin" --desc "Description"
 */

import { readFileSync, writeFileSync, cpSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const TEMPLATE = resolve(ROOT, "extensions/_template");
const EXTENSIONS = resolve(ROOT, "extensions");
const DOC_TEMPLATE = resolve(ROOT, "doc/_template.md");

const args = process.argv.slice(2);
const name = args[0];

if (!name) {
  console.error("Usage: node scripts/new-plugin.mjs <plugin-name> [--label 'Label'] [--desc 'Description']");
  process.exit(1);
}

const labelIdx = args.indexOf("--label");
const label = labelIdx >= 0 ? args[labelIdx + 1] : name;

const descIdx = args.indexOf("--desc");
const desc = descIdx >= 0 ? args[descIdx + 1] : `OpenClaw plugin: ${name}`;

const dest = resolve(EXTENSIONS, name);

if (existsSync(dest)) {
  console.error(`Plugin '${name}' already exists at ${dest}`);
  process.exit(1);
}

// Copies Base Profile TS + Extended placeholder dirs (.gitkeep / skills/README.md).
cpSync(TEMPLATE, dest, {
  recursive: true,
  filter: (src) =>
    !src.includes("node_modules") &&
    !src.includes(".DS_Store") &&
    !src.includes("/dist/") &&
    !src.endsWith("/dist"),
});

function replaceInFile(filePath) {
  if (!existsSync(filePath)) return;
  let content = readFileSync(filePath, "utf8");
  content = content.replace(/TEMPLATE_NAME/g, name);
  content = content.replace(/TEMPLATE_LABEL/g, label);
  content = content.replace(/TEMPLATE_DESCRIPTION/g, desc);
  writeFileSync(filePath, content);
}

const filesToProcess = [
  "package.json",
  "openclaw.plugin.json",
  "README.md",
  "README.zh-CN.md",
  "README.en.md",
  "src/index.ts",
  "src/channel.ts",
  "src/channel-setup-factory.ts",
  "src/config.ts",
  "src/onboarding.ts",
  "src/setup-entry.ts",
  "src/transport/server.ts",
];

for (const file of filesToProcess) {
  replaceInFile(resolve(dest, file));
}

const docDir = resolve(ROOT, "doc", name);
const guideDest = resolve(docDir, `OpenClaw-${name}-Guide.md`);
if (existsSync(DOC_TEMPLATE)) {
  mkdirSync(docDir, { recursive: true });
  let guide = readFileSync(DOC_TEMPLATE, "utf8");
  guide = guide.replace(/TEMPLATE_NAME/g, name);
  guide = guide.replace(/TEMPLATE_LABEL/g, label);
  writeFileSync(guideDest, guide);
  console.log(`   doc/${name}/OpenClaw-${name}-Guide.md`);
}

console.log(`\nPlugin created: extensions/${name}`);
console.log(`  npm: @partme.ai/openclaw-${name}`);
console.log(`  label: ${label}`);
console.log(`\nBase Profile skeleton:`);
console.log(`  extensions/${name}/`);
console.log(`  ├── openclaw.plugin.json`);
console.log(`  ├── src/index.ts              ← defineChannelPluginEntry`);
console.log(`  ├── src/channel.ts            ← ChannelPlugin`);
console.log(`  ├── src/setup-entry.ts        ← defineSetupPluginEntry`);
console.log(`  ├── src/inbound.ts / outbound.ts`);
console.log(`  ├── src/transport/server.ts   ← HTTP / transport`);
console.log(`  ├── src/*/.gitkeep            ← Extended placeholders (optional after creation, §5.2)`);
console.log(`  ├── skills/ hooks/            ← optional assets (MAY; delete if unused)`);
console.log(`  └── test/*.test.ts (+ e2e/)`);
console.log(`\nAfter scaffolding:`);
console.log(`  Remove unused src/*/.gitkeep dirs, hooks/, skills/, test/e2e/ when not needed.`);
console.log(`  Base MUST files (§5.1) are the hard requirement — placeholders are not.`);
console.log(`\nNext steps:`);
console.log(`  cd extensions/${name}`);
console.log(`  pnpm install && pnpm typecheck && pnpm test`);
