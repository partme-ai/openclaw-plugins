#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LEGACY_PLUGIN_IDS } from "./plugin-naming.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DOCUMENT_ROOTS = [join(ROOT, "README.md"), join(ROOT, "doc"), join(ROOT, "extensions")];
const EXCLUDED_FILES = new Set([
  "doc/OpenClaw-Plugin-Naming-And-Migration.md",
]);
const LEGACY_IDS = Object.freeze([
  ...new Set([
    ...Object.values(LEGACY_PLUGIN_IDS).flat(),
    // 尚未落地的设计稿也遵循相同的短 ID 规则。
    "openclaw-memory-graph",
  ]),
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function addMatches(source, pattern, rule, issues) {
  for (const match of source.matchAll(pattern)) {
    issues.push({ rule, line: lineNumberAt(source, match.index ?? 0), text: match[0] });
  }
}

/** 检查文档中的插件配置 ID；npm 包名、Channel ID、服务 ID 和日志前缀不属于此规则。 */
export function scanDocumentationText(source) {
  const issues = [];
  for (const legacyId of LEGACY_IDS) {
    const id = escapeRegExp(legacyId);
    addMatches(
      source,
      new RegExp(`plugins\\.entries(?:\\.${id}|\\[["']${id}["']\\])`, "g"),
      "legacy-config-path",
      issues,
    );
    addMatches(
      source,
      new RegExp(`pluginConfigIds[^\\n]*["']${id}["']`, "g"),
      "legacy-plugin-config-id",
      issues,
    );
    addMatches(
      source,
      new RegExp(`(?:\\bid\\s*:|["']id["']\\s*:)[ \\t]*["']${id}["']`, "g"),
      "legacy-manifest-id",
      issues,
    );
  }
  return issues;
}

function collectMarkdown(path, files) {
  const stat = statSync(path);
  if (stat.isFile()) {
    if ([".md", ".mdx"].includes(extname(path).toLowerCase())) files.push(path);
    return;
  }
  for (const entry of readdirSync(path)) {
    if (["node_modules", "dist", ".codegraph", ".git"].includes(entry)) continue;
    collectMarkdown(join(path, entry), files);
  }
}

export function checkDocumentationPluginIds() {
  const files = [];
  for (const path of DOCUMENT_ROOTS) collectMarkdown(path, files);
  const failures = [];
  for (const path of files.sort()) {
    const repoPath = relative(ROOT, path);
    if (EXCLUDED_FILES.has(repoPath) || basename(path).toLowerCase() === "changelog.md") continue;
    for (const issue of scanDocumentationText(readFileSync(path, "utf8"))) {
      failures.push({ file: repoPath, ...issue });
    }
  }
  return { checked: files.length, failures };
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  const result = checkDocumentationPluginIds();
  if (result.failures.length > 0) {
    console.error(`Documentation plugin ID check failed with ${result.failures.length} issue(s):`);
    for (const failure of result.failures) {
      console.error(`- ${failure.file}:${failure.line} [${failure.rule}] ${failure.text}`);
    }
    process.exit(1);
  }
  console.log(`Documentation plugin ID check passed for ${result.checked} Markdown files.`);
}

