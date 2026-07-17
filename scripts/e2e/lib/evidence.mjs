/**
 * E2E 源码证据指纹。
 *
 * E2E 报告只能证明“当时打包并安装的那份代码”通过。这里将插件运行源码、发布清单、
 * E2E 适配器、共享 message-sdk 和锁文件纳入 SHA-256；任一运行相关输入变化后，旧报告
 * 会立即失效，避免把历史 PASS 误当作当前工作区的生产就绪证明。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import { findExtension } from "./registry.mjs";
import { REPO_ROOT } from "./utils.mjs";

const PLUGIN_FILES = [
  "package.json",
  "openclaw.plugin.json",
  "tsconfig.json",
  "tsup.config.ts",
];
const SHARED_SDK_FILES = [
  "extensions/message-sdk/src",
  "extensions/message-sdk/package.json",
  "extensions/message-sdk/openclaw.plugin.json",
  "extensions/message-sdk/tsconfig.json",
  "extensions/message-sdk/tsup.config.ts",
];
const SHARED_HARNESS_FILES = [
  "scripts/e2e/run-e2e.mjs",
  "scripts/e2e/lib",
  "scripts/e2e/helpers",
  "scripts/e2e/bootstrap",
  "scripts/e2e/docker-compose.yml",
];

/**
 * 计算一个插件当前可执行候选物对应的稳定指纹。
 * 路径和文件内容都会参与摘要，目录遍历固定排序，保证不同机器得到相同结果。
 *
 * @param {string} pluginId
 * @param {{ repoRoot?: string }} [options]
 */
export function sourceFingerprint(pluginId, options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const extension = findExtension(pluginId);
  if (!extension.e2eAdapter) {
    throw new Error(`Extension ${pluginId} has no standalone E2E adapter`);
  }

  const candidates = [
    `${extension.dir}/src`,
    ...PLUGIN_FILES.map((file) => `${extension.dir}/${file}`),
    `scripts/e2e/plugins/${pluginId}.mjs`,
    `scripts/e2e/config/plugins/${pluginId}.mjs`,
    "pnpm-lock.yaml",
    ...SHARED_SDK_FILES,
    ...SHARED_HARNESS_FILES,
  ];
  const files = candidates.flatMap((candidate) => collectFiles(resolve(repoRoot, candidate)));
  const uniqueFiles = [...new Set(files)].sort((left, right) =>
    relative(repoRoot, left).localeCompare(relative(repoRoot, right)),
  );
  if (uniqueFiles.length === 0) throw new Error(`No evidence inputs found for ${pluginId}`);

  const hash = createHash("sha256");
  for (const file of uniqueFiles) {
    const path = relative(repoRoot, file).replaceAll("\\", "/");
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** @param {string} path */
function collectFiles(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => !entry.name.endsWith(".test.mjs"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => collectFiles(resolve(path, entry.name)));
}
