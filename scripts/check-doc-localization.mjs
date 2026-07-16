#!/usr/bin/env node

/**
 * 中文插件入口文档完整性审计。
 *
 * README.zh-CN.md 可以链接到完整手册，但不能退化为只有一句“请看 README.md”的跳转页。
 * 门禁检查最低正文长度、中文内容、完整代码围栏，以及是否仍使用已知的跳转页措辞。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS_ROOT = path.join(ROOT, "extensions");
const MIN_LINES = 20;
const CHINESE = /[\u3400-\u9fff]/u;
const REDIRECT_ONLY = /(?:中文主文档已迁移|本文件保留为旧链接兼容入口|请以同目录\s*\[?README\.md)/u;

const readmes = fs
  .readdirSync(EXTENSIONS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(EXTENSIONS_ROOT, entry.name, "README.zh-CN.md"))
  .filter((file) => fs.existsSync(file))
  .sort();

const findings = [];
for (const file of readmes) {
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/u);
  const nonEmptyLines = lines.filter((line) => line.trim()).length;
  const fenceCount = lines.filter((line) => line.trimStart().startsWith("```")).length;
  const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");

  if (nonEmptyLines < MIN_LINES) {
    findings.push(`${relative}：仅 ${nonEmptyLines} 行有效正文，最低要求 ${MIN_LINES} 行`);
  }
  if (!CHINESE.test(source)) {
    findings.push(`${relative}：缺少中文正文`);
  }
  if (REDIRECT_ONLY.test(source)) {
    findings.push(`${relative}：仍包含跳转页占位措辞`);
  }
  if (fenceCount % 2 !== 0) {
    findings.push(`${relative}：Markdown 代码围栏未闭合`);
  }
}

console.log(`中文入口文档审计：${readmes.length} 个 README.zh-CN.md，最低 ${MIN_LINES} 行有效正文。`);
if (findings.length === 0) {
  console.log("通过：所有中文插件入口均可独立阅读，不是跳转页占位符。");
  process.exit(0);
}

for (const finding of findings) console.log(`- ${finding}`);
process.exitCode = 1;
