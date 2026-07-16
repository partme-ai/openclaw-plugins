#!/usr/bin/env node

/**
 * 全仓生产源码中文注释审计。
 *
 * 这不是“注释数量”统计：检查目标是核心源码是否在文件入口解释架构职责，以及导出的公共
 * API 是否有紧邻声明的 JSDoc。测试、类型声明、生成代码和纯配置文件不进入生产注释门禁。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS_ROOT = path.join(ROOT, "extensions");
const STRICT = process.argv.includes("--strict");
const CHECK_PUBLIC_API = process.argv.includes("--public-api");
const CHINESE = /[\u3400-\u9fff]/u;
const CORE_BASENAMES = new Set([
  "channel.ts",
  "client.ts",
  "index.ts",
  "inbound.ts",
  "outbound.ts",
  "plugin.ts",
  "provider.ts",
  "server.ts",
  "service.ts",
]);

function walk(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function isProductionSource(file) {
  const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
  return (
    /\/src\/.*\.[cm]?tsx?$/u.test(relative) &&
    !/\.(?:test|spec)\.[cm]?tsx?$/u.test(relative) &&
    !/\.d\.[cm]?ts$/u.test(relative) &&
    !/(?:^|\/)(?:test|tests|__tests__|generated)(?:\/|$)/u.test(relative) &&
    !/(?:^|\/)setup-entry\.[cm]?ts$/u.test(relative)
  );
}

function hasChineseFileJSDoc(source) {
  const withoutDirectives = source
    .replace(/^#![^\n]*\n/u, "")
    .replace(/^(?:\s*\/\/\s*@(ts-nocheck|ts-check|eslint-disable)[^\n]*\n)+/u, "");
  const match = withoutDirectives.match(/^\s*\/\*\*[\s\S]*?\*\//u);
  return Boolean(match && CHINESE.test(match[0]));
}

function logicalLineCount(source) {
  return source
    .split(/\r?\n/u)
    .filter((line) => line.trim() && !line.trim().startsWith("//")).length;
}

function isCoreSource(file, source) {
  const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
  const basename = path.basename(file);
  return (
    CORE_BASENAMES.has(basename) ||
    /\/src\/(?:runtime|transport|dispatch|security)\/[^/]+\.[cm]?tsx?$/u.test(relative) ||
    logicalLineCount(source) >= 120
  );
}

function publicApiIssues(source) {
  const lines = source.split(/\r?\n/u);
  const issues = [];
  const declaration = /^\s*export\s+(?:(?:declare|default|async|abstract)\s+)*(?:class|function|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/u;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(declaration);
    if (!match) continue;

    let cursor = index - 1;
    while (cursor >= 0 && !lines[cursor].trim()) cursor -= 1;
    if (cursor < 0 || !lines[cursor].trim().endsWith("*/")) {
      issues.push({ line: index + 1, symbol: match[1] });
      continue;
    }

    const comment = [];
    while (cursor >= 0) {
      comment.unshift(lines[cursor]);
      if (lines[cursor].includes("/**")) break;
      cursor -= 1;
    }
    const text = comment.join("\n");
    if (!text.includes("/**") || !CHINESE.test(text)) {
      issues.push({ line: index + 1, symbol: match[1] });
    }
  }
  return issues;
}

const sourceFiles = walk(EXTENSIONS_ROOT).filter(isProductionSource).sort();
const findings = [];
let coreFileCount = 0;

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
  const core = isCoreSource(file, source);
  if (core) coreFileCount += 1;
  if (core && !hasChineseFileJSDoc(source)) {
    findings.push({ plugin: relative.split("/")[1], file: relative, kind: "缺少文件级中文职责说明" });
  }
  if (CHECK_PUBLIC_API) {
    for (const issue of publicApiIssues(source)) {
      findings.push({
        plugin: relative.split("/")[1],
        file: `${relative}:${issue.line}`,
        kind: `公共 API 缺少中文 JSDoc：${issue.symbol}`,
      });
    }
  }
}

console.log(`中文注释审计：${sourceFiles.length} 个生产源码文件，${coreFileCount} 个核心文件。`);
if (findings.length === 0) {
  console.log("通过：未发现缺少中文解释性注释的目标文件或公共 API。");
  process.exit(0);
}

let currentPlugin = "";
for (const finding of findings) {
  if (finding.plugin !== currentPlugin) {
    currentPlugin = finding.plugin;
    console.log(`\n[${currentPlugin}]`);
  }
  console.log(`- ${finding.file} — ${finding.kind}`);
}
console.log(`\n共发现 ${findings.length} 个问题。`);
if (!STRICT) {
  console.log("当前为报告模式；使用 --strict 可将未修复问题作为 CI 失败处理。");
}
process.exitCode = STRICT ? 1 : 0;
