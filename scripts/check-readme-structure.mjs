#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { COMPONENT_ARCHITECTURES, readmeLanguage } from "./readme-architecture-data.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const EXTENSIONS = join(ROOT, "extensions");
const START = "<!-- README_STANDARD_START -->";
const END = "<!-- README_STANDARD_END -->";
const HEADINGS = Object.freeze({
  en: [
    "## 1. Component positioning",
    "## 2. At a glance",
    "## 3. Architecture and core flow",
    "## 4. Capabilities and boundaries",
    "## 5. Quick start",
    "## 6. Configuration entry points",
    "## 7. Operations, security, and troubleshooting",
    "## 8. Verification and deep dives",
    "## 9. Preserved detailed reference",
  ],
  zh: [
    "## 1. 组件定位",
    "## 2. 一眼看懂",
    "## 3. 架构与核心流程",
    "## 4. 能力与边界",
    "## 5. 快速开始",
    "## 6. 配置入口",
    "## 7. 运维、安全与故障定位",
    "## 8. 验证与深入阅读",
    "## 9. 原有详细说明",
  ],
});

function extractBlock(source) {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start < 0 || end < start) return null;
  return source.slice(start, end + END.length);
}

export function checkReadmeStructure() {
  const failures = [];
  const ids = readdirSync(EXTENSIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();

  for (const id of ids) {
    if (!COMPONENT_ARCHITECTURES[id]) failures.push(`${id}: 缺少架构元数据`);
    const root = join(EXTENSIONS, id);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(root, "openclaw.plugin.json"), "utf8"));
    for (const file of ["README.md", "README.zh-CN.md"]) {
      const headings = HEADINGS[readmeLanguage(id, file)];
      const path = join(root, file);
      if (!existsSync(path)) {
        failures.push(`${id}/${file}: 文件不存在`);
        continue;
      }
      const source = readFileSync(path, "utf8");
      const startMarkers = source.split(START).length - 1;
      const endMarkers = source.split(END).length - 1;
      if (startMarkers !== 1 || endMarkers !== 1) {
        failures.push(`${id}/${file}: 标准区块标记必须各出现一次`);
      }
      const block = extractBlock(source);
      if (!block) {
        failures.push(`${id}/${file}: 缺少标准区块标记`);
        continue;
      }
      let previous = -1;
      for (const heading of headings) {
        const index = block.indexOf(heading);
        if (index < 0) failures.push(`${id}/${file}: 缺少章节 ${heading}`);
        if (index >= 0 && index <= previous) failures.push(`${id}/${file}: 章节顺序错误 ${heading}`);
        previous = index;
      }
      const textDiagrams = [...block.matchAll(/^```text\s*$/gmu)].length;
      if (textDiagrams < 2) failures.push(`${id}/${file}: 标准区块至少需要 2 个 text 图`);
      if (/^```mermaid\s*$/mu.test(block)) failures.push(`${id}/${file}: 标准区块不得依赖 Mermaid`);
      if (!block.includes(`\`${pkg.name}\``)) failures.push(`${id}/${file}: npm 包名与 package.json 不一致`);
      if (!block.includes(`\`${manifest.id}\``)) failures.push(`${id}/${file}: 插件 ID 与 manifest 不一致`);
      if (!block.includes(`\`extensions/${id}\``)) failures.push(`${id}/${file}: 源码目录不一致`);
      const centeredHeaderStart = source.search(/<div\b[^>]*align=["']center["'][^>]*>/iu);
      const centeredHeaderEnd = centeredHeaderStart >= 0 ? source.indexOf("</div>", centeredHeaderStart) : -1;
      const blockStart = source.indexOf(START);
      if (centeredHeaderStart >= 0 && blockStart > centeredHeaderStart && blockStart < centeredHeaderEnd) {
        failures.push(`${id}/${file}: 标准正文不得放在居中标题容器内`);
      }
    }
  }

  return { components: ids.length, readmes: ids.length * 2, failures };
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  const result = checkReadmeStructure();
  if (result.failures.length > 0) {
    console.error(`README structure check failed with ${result.failures.length} issue(s):`);
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`README structure check passed: ${result.components} components, ${result.readmes} bilingual README files.`);
}
