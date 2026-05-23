#!/usr/bin/env node
/**
 * new-plugin.mjs — Generate a new plugin from _template.
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

// Copy template (skip files that shouldn't be in real plugins)
cpSync(TEMPLATE, dest, {
  recursive: true,
  filter: (src) => !src.includes("node_modules") && !src.includes(".DS_Store"),
});

// Replace placeholders in template files
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
  "index.ts",
  "src/channel.ts",
  "src/config.ts",
  "src/types.ts",
  "src/monitor.ts",
];

for (const file of filesToProcess) {
  replaceInFile(resolve(dest, file));
}

// Generate doc guide from template (doc/<name>/OpenClaw-<name>-Guide.md)
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
console.log(`  npm: @partme.ai/${name}`);
console.log(`  label: ${label}`);
console.log(`\nFiles:`);
console.log(`  extensions/${name}/`);
console.log(`  ├── index.ts`);
console.log(`  ├── src/`);
console.log(`  │   ├── channel.ts   ← implement ChannelPlugin`);
console.log(`  │   ├── config.ts    ← define config schema`);
console.log(`  │   ├── media.ts     ← media loading & type detection`);
console.log(`  │   ├── monitor.ts   ← message dedup & webhook handler`);
console.log(`  │   ├── runtime.ts   ← state singleton`);
console.log(`  │   └── types.ts     ← type definitions`);
console.log(`  └── doc/${name}/OpenClaw-${name}-Guide.md ← setup guide`);
console.log(`\nNext steps:`);
console.log(`  cd extensions/${name}`);
console.log(`  # 1. Edit src/channel.ts — implement your channel`);
console.log(`  # 2. Edit src/config.ts — Zod schema + JSON Schema`);
console.log(`  # 3. Edit src/monitor.ts — parseInboundMessage() & webhook handler`);
console.log(`  # 4. Edit src/media.ts — extractInboundMedia() for your platform`);
console.log(`  # 5. Write tests following <module>.<feature>.test.ts convention`);
console.log(`  pnpm install && npx tsc --noEmit`);
