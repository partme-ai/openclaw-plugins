#!/usr/bin/env node
/**
 * message-sdk workspace 依赖工具。
 *
 * 开发：package.json 使用 workspace:^<message-sdk-version>
 * 发布：publish-changed.mjs 临时 materialize 为 ^<version>，发布后还原
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const PLUGINS_DIR = resolve(ROOT, "extensions");
const MESSAGE_SDK_PKG = "@partme.ai/openclaw-message-sdk";
const MESSAGE_SDK_PATH = resolve(PLUGINS_DIR, "message-sdk");
const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"];

/**
 * 读取 message-sdk 当前版本号。
 */
export function readMessageSdkVersion() {
  const pkg = JSON.parse(readFileSync(resolve(MESSAGE_SDK_PATH, "package.json"), "utf8"));
  if (!pkg.version) {
    throw new Error("message-sdk package.json missing version");
  }
  return pkg.version;
}

/**
 * 生成 monorepo 开发用 workspace 依赖写法。
 */
export function workspaceSpecifier(version) {
  return `workspace:^${version}`;
}

/**
 * 将 workspace 协议转为 npm 可发布的 semver range。
 */
export function materializeSpecifier(specifier, fallbackVersion) {
  if (!specifier.startsWith("workspace:")) {
    return specifier;
  }
  const range = specifier.slice("workspace:".length);
  if (range === "*") {
    return `^${fallbackVersion}`;
  }
  return range;
}

/**
 * 列出含 message-sdk 依赖的插件 package.json 路径（不含 message-sdk 自身）。
 */
export function listMessageSdkConsumerPkgPaths() {
  const paths = [];
  for (const entry of readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name === "message-sdk") {
      continue;
    }
    const pkgPath = resolve(PLUGINS_DIR, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (hasMessageSdkDep(pkg)) {
      paths.push({ dir: entry.name, path: pkgPath, pkg });
    }
  }
  return paths.sort((a, b) => a.dir.localeCompare(b.dir));
}

function hasMessageSdkDep(pkg) {
  return DEP_SECTIONS.some((section) => pkg[section]?.[MESSAGE_SDK_PKG]);
}

/**
 * 将 package.json 对象中的 workspace 依赖转为 npm semver（用于发布 tarball）。
 */
export function materializePkgJsonForPublish(pkg, sdkVersion = readMessageSdkVersion()) {
  const next = structuredClone(pkg);
  let changed = false;

  for (const section of DEP_SECTIONS) {
    const block = next[section];
    if (!block?.[MESSAGE_SDK_PKG]) continue;
    const current = block[MESSAGE_SDK_PKG];
    const resolved = materializeSpecifier(current, sdkVersion);
    if (resolved !== current) {
      block[MESSAGE_SDK_PKG] = resolved;
      changed = true;
    }
  }

  return { pkg: next, changed };
}

/**
 * 将所有消费者的 message-sdk 依赖同步为 workspace:^<sdkVersion>。
 */
export function syncMessageSdkWorkspaceDeps(options = {}) {
  const sdkVersion = options.version ?? readMessageSdkVersion();
  const target = workspaceSpecifier(sdkVersion);
  const updated = [];

  for (const { dir, path: pkgPath, pkg } of listMessageSdkConsumerPkgPaths()) {
    let fileChanged = false;
    for (const section of DEP_SECTIONS) {
      const block = pkg[section];
      if (!block?.[MESSAGE_SDK_PKG]) continue;
      if (block[MESSAGE_SDK_PKG] !== target) {
        block[MESSAGE_SDK_PKG] = target;
        fileChanged = true;
      }
    }
    if (fileChanged) {
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      updated.push(dir);
    }
  }

  return { sdkVersion, target, updated };
}
