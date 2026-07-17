#!/usr/bin/env node

/**
 * 中文文档可理解性门禁。
 *
 * 防止架构说明再次被压缩成跳转链接或纯文字短文，也防止插件中文 README 在重写时只留下
 * 宣传性描述：架构文档和中文 README 都必须有 Mermaid；README 还必须保留可复制的配置、
 * 命令或调用示例。门禁只检查资产是否存在，图与代码是否符合当前实现仍由评审和 E2E 负责。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEARCH_ROOTS = [path.join(ROOT, "doc"), path.join(ROOT, "extensions")];
const MIN_LINES = 40;
const EXAMPLE_LANGUAGES = new Set([
  "bash",
  "javascript",
  "json",
  "jsonc",
  "sh",
  "toml",
  "typescript",
  "yaml",
  "yml",
]);

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

function isPluginChineseReadme(file) {
  return (
    path.basename(file) === "README.zh-CN.md" &&
    path.relative(path.join(ROOT, "extensions"), file).split(path.sep).length === 2
  );
}

function fencedLanguages(source) {
  return [...source.matchAll(/^```([^\s`]*)\s*$/gmu)].map((match) =>
    (match[1] ?? "").toLowerCase(),
  );
}

const documents = SEARCH_ROOTS.flatMap(walk).filter(isArchitectureDocument).sort();
const pluginReadmes = walk(path.join(ROOT, "extensions")).filter(isPluginChineseReadme).sort();
const problems = [];

for (const file of [...documents, ...pluginReadmes]) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
  const lines = source.split(/\r?\n/u).length;
  const mermaidBlocks = [...source.matchAll(/```mermaid\s*\n([\s\S]*?)```/gu)];
  const fenceCount = [...source.matchAll(/^```/gmu)].length;

  if (lines < MIN_LINES) problems.push(`${relative}: 只有 ${lines} 行，原理说明过短`);
  if (mermaidBlocks.length === 0) problems.push(`${relative}: 缺少 Mermaid 架构/流程图`);
  if (mermaidBlocks.some((match) => !match[1]?.trim())) problems.push(`${relative}: 存在空 Mermaid 图块`);
  if (fenceCount % 2 !== 0) problems.push(`${relative}: Markdown 代码围栏未闭合`);
  if (
    isPluginChineseReadme(file) &&
    !fencedLanguages(source).some((language) => EXAMPLE_LANGUAGES.has(language))
  ) {
    problems.push(`${relative}: 缺少可复制的配置、命令或调用代码示例`);
  }
}

console.log(
  `中文文档审计：${documents.length} 个架构文档 + ${pluginReadmes.length} 个插件 README，` +
    `最低 ${MIN_LINES} 行，必须包含 Mermaid；README 必须包含代码示例。`,
);
if (problems.length > 0) {
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log("通过：所有目标文档均包含可视化图例、完整正文结构和所需代码示例。");
}
