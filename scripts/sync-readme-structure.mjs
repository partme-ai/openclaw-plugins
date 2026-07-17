#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { COMPONENT_ARCHITECTURES, readmeLanguage } from "./readme-architecture-data.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const EXTENSIONS = join(ROOT, "extensions");
const START = "<!-- README_STANDARD_START -->";
const END = "<!-- README_STANDARD_END -->";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function displayList(values) {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "—";
}

function pluginConfigPath(pkg, manifest) {
  if (!Array.isArray(pkg.openclaw?.extensions) || pkg.openclaw.extensions.length === 0) return null;
  return `plugins.entries.${manifest.id}.config`;
}

function channelConfigPaths(manifest) {
  return (manifest.channels ?? []).map((id) => `channels["${id}"]`);
}

function architectureDiagram(id, data, lang) {
  const label = lang === "zh" ? "OpenClaw Gateway 内" : "Inside OpenClaw Gateway";
  const lines = [
    `[${data.input[lang]}]`,
    "          │",
    "          ▼",
    `┌──────────────────────────────────────────────────────────────┐`,
    `│ ${label}: ${id}`,
    ...data.stages.map((stage, index) => `│ ${index + 1}. ${stage[lang]}`),
    `└──────────────────────────────────────────────────────────────┘`,
    "          │",
    "          ▼",
    `[${data.output[lang]}]`,
  ];
  return lines.join("\n");
}

function lifecycleDiagram(data, lang) {
  const failure = lang === "zh" ? "任一步失败：记录可诊断错误并按组件策略重试、拒绝或降级" : "Any failed stage: record a diagnosable error, then retry, reject, or degrade per component policy";
  const failureLabel = lang === "zh" ? "异常路径" : "Failure path";
  return [
    data.input[lang],
    ...data.stages.flatMap((stage) => ["  │", "  ▼", stage[lang]]),
    "  │",
    "  ▼",
    data.output[lang],
    "",
    `${failureLabel}: ${failure}`,
  ].join("\n");
}

function deepDocLink(id, lang) {
  if (existsSync(join(ROOT, "doc", id))) {
    return lang === "zh"
      ? `- [${id} 深度设计文档](../../doc/${id}/)`
      : `- [${id} deep-design documents](../../doc/${id}/)`;
  }
  return lang === "zh"
    ? "- [插件总体架构](../../doc/OpenClaw-Plugins-Architecture_CN.md)"
    : "- [Plugin architecture overview](../../doc/OpenClaw-Plugins-Architecture.md)";
}

function languageNavigation(id, lang) {
  const root = join(EXTENSIONS, id);
  const defaultLanguage = readmeLanguage(id, "README.md");
  const chineseTarget = defaultLanguage === "zh" ? "./README.md" : "./README.zh-CN.md";
  const englishTarget = defaultLanguage === "en"
    ? "./README.md"
    : (existsSync(join(root, "README.en.md")) ? "./README.en.md" : null);
  const chinese = `[简体中文](${chineseTarget})`;
  const english = englishTarget ? `[English](${englishTarget})` : null;
  return lang === "zh"
    ? [chinese, english].filter(Boolean).join(" | ")
    : [english, chinese].filter(Boolean).join(" | ");
}

function renderZh(id, pkg, manifest, data) {
  const configPath = pluginConfigPath(pkg, manifest);
  const channels = manifest.channels ?? [];
  const channelPaths = channelConfigPaths(manifest);
  const hostRange = pkg.peerDependencies?.openclaw ?? "不直接依赖宿主运行时";
  const install = configPath
    ? `openclaw plugins install "${pkg.name}@${pkg.version}"`
    : `npm install "${pkg.name}@${pkg.version}"`;
  return `${START}

> 统一阅读顺序：组件定位 → 架构 → 流程 → 边界 → 安装 → 配置 → 运维 → 深入阅读。
> 本区块以 npm 可稳定渲染的 text 图为主；适用时，更深入的 Mermaid 图保留在仓库 \`doc/\` 设计资料中。

${languageNavigation(id, "zh")}

## 1. 组件定位

${data.does.zh}。组件类型：**${data.category.zh}**。

| 项目 | 内容 |
|---|---|
| npm 包 | \`${pkg.name}\` |
| 当前版本 | \`${pkg.version}\` |
| 插件 ID | \`${manifest.id}\` |
| Channel ID | ${displayList(channels)} |
| OpenClaw | \`${hostRange}\` |
| 源码目录 | \`extensions/${id}\` |

## 2. 一眼看懂

\`\`\`text
${architectureDiagram(id, data, "zh")}
\`\`\`

## 3. 架构与核心流程

该组件把“协议/平台差异”限制在自身边界内，对 OpenClaw 暴露稳定的插件、Channel、Hook、Tool 或 Service 契约。

\`\`\`text
${lifecycleDiagram(data, "zh")}
\`\`\`

## 4. 能力与边界

| 能力 | 说明 |
|---|---|
| 负责 | ${data.does.zh} |
| 不负责 | ${data.excludes.zh} |
| 输入 | ${data.input.zh} |
| 输出 | ${data.output.zh} |
| 失败原则 | 默认失败应可观测；鉴权、边界校验和持久化失败不得伪装成功 |

## 5. 快速开始

\`\`\`bash
${install}
\`\`\`

安装后先按最小权限配置，再启动 Gateway；生产环境应在隔离配置目录中完成连通性、权限和失败恢复验证。

## 6. 配置入口

| 配置层 | 路径 |
|---|---|
| 插件配置 | ${configPath ? `\`${configPath}\`` : "无运行时插件配置；由消费方作为 SDK 依赖引入"} |
| Channel 配置 | ${channelPaths.length > 0 ? channelPaths.map((path) => `\`${path}\``).join(", ") : "不适用"} |
| 配置 Schema | \`extensions/${id}/openclaw.plugin.json\` |

配置字段、环境变量与完整示例继续保留在下方原有详细说明中。

## 7. 运维、安全与故障定位

- 先确认 OpenClaw 版本、插件版本、manifest ID 与配置键一致。
- 凭据使用环境变量或 SecretRef，不写入日志、仓库和示例明文。
- 通过 Gateway 日志、插件健康状态及外部依赖状态分层定位问题。
- 升级前备份状态数据；涉及游标、队列或索引时，必须验证重启恢复与重复投递语义。

## 8. 验证与深入阅读

\`\`\`bash
pnpm --filter "${pkg.name}" typecheck
pnpm --filter "${pkg.name}" test
pnpm --filter "${pkg.name}" build
\`\`\`

${deepDocLink(id, "zh")}
- [统一插件结构规范](../../doc/OpenClaw-Plugins-Structure-Standard.md)

## 9. 原有详细说明

以下内容保留该组件原有的配置表、协议细节、示例和故障排查资料。

${END}`;
}

function renderEn(id, pkg, manifest, data) {
  const configPath = pluginConfigPath(pkg, manifest);
  const channels = manifest.channels ?? [];
  const channelPaths = channelConfigPaths(manifest);
  const hostRange = pkg.peerDependencies?.openclaw ?? "No direct host runtime dependency";
  const install = configPath
    ? `openclaw plugins install "${pkg.name}@${pkg.version}"`
    : `npm install "${pkg.name}@${pkg.version}"`;
  return `${START}

> Standard reading order: positioning → architecture → flow → boundaries → installation → configuration → operations → deep dive.
> This block favors text diagrams that render reliably on npm; when applicable, deeper Mermaid diagrams remain in the repository's \`doc/\` design material.

${languageNavigation(id, "en")}

## 1. Component positioning

${data.does.en}. Component type: **${data.category.en}**.

| Item | Value |
|---|---|
| npm package | \`${pkg.name}\` |
| Version | \`${pkg.version}\` |
| Plugin ID | \`${manifest.id}\` |
| Channel ID | ${displayList(channels)} |
| OpenClaw | \`${hostRange}\` |
| Source | \`extensions/${id}\` |

## 2. At a glance

\`\`\`text
${architectureDiagram(id, data, "en")}
\`\`\`

## 3. Architecture and core flow

The component keeps protocol and platform differences inside its own boundary and exposes stable plugin, channel, hook, tool, or service contracts to OpenClaw.

\`\`\`text
${lifecycleDiagram(data, "en")}
\`\`\`

## 4. Capabilities and boundaries

| Area | Contract |
|---|---|
| Owns | ${data.does.en} |
| Does not own | ${data.excludes.en} |
| Input | ${data.input.en} |
| Output | ${data.output.en} |
| Failure rule | Failures remain observable; authentication, boundary validation, and persistence failures must not be reported as success |

## 5. Quick start

\`\`\`bash
${install}
\`\`\`

Start with least-privilege configuration, then launch the Gateway. Validate connectivity, authorization, and recovery in an isolated profile before production use.

## 6. Configuration entry points

| Layer | Path |
|---|---|
| Plugin configuration | ${configPath ? `\`${configPath}\`` : "No runtime plugin configuration; consumers install it as an SDK dependency"} |
| Channel configuration | ${channelPaths.length > 0 ? channelPaths.map((path) => `\`${path}\``).join(", ") : "Not applicable"} |
| Configuration schema | \`extensions/${id}/openclaw.plugin.json\` |

Field definitions, environment variables, and complete examples remain in the preserved detailed reference below.

## 7. Operations, security, and troubleshooting

- Confirm the OpenClaw version, package version, manifest ID, and configuration key first.
- Keep credentials in environment variables or SecretRef values, never in logs, source control, or plaintext examples.
- Diagnose by layer: Gateway logs, plugin health, then the external dependency.
- Back up state before upgrades; for cursors, queues, or indexes, verify restart recovery and duplicate-delivery semantics.

## 8. Verification and deep dives

\`\`\`bash
pnpm --filter "${pkg.name}" typecheck
pnpm --filter "${pkg.name}" test
pnpm --filter "${pkg.name}" build
\`\`\`

${deepDocLink(id, "en")}
- [Unified plugin structure standard](../../doc/OpenClaw-Plugins-Structure-Standard.md)

## 9. Preserved detailed reference

The original configuration tables, protocol details, examples, and troubleshooting material continue below.

${END}`;
}

function upsertBlock(source, block) {
  // 先移除旧区块再重新定位，确保生成器能修复历史上插入到居中标题容器内的区块。
  const markerPattern = new RegExp(`\\n*${START}[\\s\\S]*?${END}\\n*`, "u");
  const cleanSource = source.replace(markerPattern, "\n\n");
  const lines = cleanSource.split(/\r?\n/u);
  const titleIndex = lines.findIndex((line) => /^#\s+/u.test(line));
  if (titleIndex < 0) throw new Error("README missing H1 title");

  // npm README 常用 <div align="center"> 包住标题、徽章和语言链接；标准正文必须放在
  // 关闭标签之后，否则表格和 text 架构图也会被整体居中，阅读体验会明显变差。
  const openingDivIndex = lines.findLastIndex((line, index) => index < titleIndex && /<div\b[^>]*>/iu.test(line));
  const closingDivIndex = openingDivIndex >= 0
    ? lines.findIndex((line, index) => index > titleIndex && index < 80 && /<\/div>/iu.test(line))
    : -1;
  const insertIndex = closingDivIndex >= 0 ? closingDivIndex + 1 : titleIndex + 1;
  lines.splice(insertIndex, 0, "", block, "");
  return `${lines.join("\n").trimEnd()}\n`;
}

const extensionIds = readdirSync(EXTENSIONS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .map((entry) => entry.name)
  .sort();

const missingMetadata = extensionIds.filter((id) => !COMPONENT_ARCHITECTURES[id]);
if (missingMetadata.length > 0) {
  throw new Error(`Missing README architecture metadata: ${missingMetadata.join(", ")}`);
}

let changed = 0;
for (const id of extensionIds) {
  const root = join(EXTENSIONS, id);
  const pkg = readJson(join(root, "package.json"));
  const manifest = readJson(join(root, "openclaw.plugin.json"));
  for (const file of ["README.md", "README.zh-CN.md"]) {
    const path = join(root, file);
    if (!existsSync(path)) throw new Error(`${id}: missing ${file}`);
    const source = readFileSync(path, "utf8");
    const lang = readmeLanguage(id, file);
    const block = lang === "zh"
      ? renderZh(id, pkg, manifest, COMPONENT_ARCHITECTURES[id])
      : renderEn(id, pkg, manifest, COMPONENT_ARCHITECTURES[id]);
    const next = upsertBlock(source, block);
    if (next !== source) {
      writeFileSync(path, next);
      changed += 1;
    }
  }
}

console.log(`README standard blocks synchronized: ${extensionIds.length} components, ${changed} file(s) changed.`);
