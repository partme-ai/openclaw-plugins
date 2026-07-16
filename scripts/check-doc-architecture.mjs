#!/usr/bin/env node

/**
 * 架构文档结构门禁：防止架构说明再次被压缩成跳转链接或纯文字短文。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEARCH_ROOTS = [path.join(ROOT, "doc"), path.join(ROOT, "extensions")];
const MIN_LINES = 40;

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function isArchitectureDocument(file) {
  if (!file.endsWith(".md")) return false;
  const name = path.basename(file);
  return /architecture|架构/iu.test(name);
}

const documents = SEARCH_ROOTS.flatMap(walk).filter(isArchitectureDocument).sort();
const problems = [];

for (const file of documents) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
  const lines = source.split(/\r?\n/u).length;
  const mermaidBlocks = [...source.matchAll(/```mermaid\s*\n([\s\S]*?)```/gu)];
  const fenceCount = [...source.matchAll(/^```/gmu)].length;

  if (lines < MIN_LINES) problems.push(`${relative}: 只有 ${lines} 行，架构原理说明过短`);
  if (mermaidBlocks.length === 0) problems.push(`${relative}: 缺少 Mermaid 架构/流程图`);
  if (mermaidBlocks.some((match) => !match[1]?.trim())) problems.push(`${relative}: 存在空 Mermaid 图块`);
  if (fenceCount % 2 !== 0) problems.push(`${relative}: Markdown 代码围栏未闭合`);
}

console.log(`架构文档审计：${documents.length} 个文档，最低 ${MIN_LINES} 行，必须包含 Mermaid。`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log("通过：所有架构文档均包含可视化图例和完整正文结构。");
}
