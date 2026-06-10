/**
 * @module media/path-guard
 *
 * 路径沙箱：优先 OpenClaw security-runtime，否则受限本地实现。
 *
 * **职责**：
 * - 在指定 root 内安全读写常规文件
 * - 常量时间比较密钥（防时序攻击）
 *
 * **关键导出**：`getPathGuard`、`createLocalPathGuard`
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { importOpenClawPluginSdk } from "../openclaw/loader.js";

/**
 * 路径守卫读文件选项 / Options for guarded file reads.
 *
 * @property maxBytes - 最大可读字节数（超出则拒绝）
 * @property rootDir - 根目录沙箱（路径不得逃逸出该目录）
 */
export type PathGuardReadOptions = {
  maxBytes?: number;
  rootDir?: string;
};

/**
 * 路径守卫 API 契约 / Path guard API contract.
 *
 * 通道插件通过 {@link getPathGuard} 获取单例实例，避免自行实现路径穿越校验。
 */
export type PathGuardApi = {
  /** 读取常规文件（非目录、非符号链接逃逸） */
  readRegularFile: (filePath: string, options?: PathGuardReadOptions) => Promise<Buffer>;
  /** 同步 stat 常规文件 */
  statRegularFileSync: (filePath: string, rootDir?: string) => fs.Stats;
  /** 在 root 内写入外部文件（相对路径） */
  writeExternalFileWithinRoot: (params: {
    rootDir: string;
    relativePath: string;
    data: Buffer | string;
  }) => Promise<string>;
  /** 常量时间比较两个密钥字符串 */
  safeEqualSecret: (a: string, b: string) => boolean;
};

/**
 * 将路径解析并约束在 rootDir 内；若发生目录穿越则抛错。
 *
 * @param filePath - 待解析的文件路径
 * @param rootDir - 可选根目录沙箱
 * @returns 解析后的绝对路径
 */
function resolveWithinRoot(filePath: string, rootDir?: string): string {
  const resolved = path.resolve(filePath);
  if (!rootDir?.trim()) return resolved;
  const root = path.resolve(rootDir);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes root: ${filePath}`);
  }
  return resolved;
}

/**
 * 创建受限本地路径守卫（OpenClaw security-runtime 不可用时的降级实现）。
 *
 * @returns 满足 {@link PathGuardApi} 的本地实现
 */
function createLocalPathGuard(): PathGuardApi {
  return {
    async readRegularFile(filePath, options) {
      const resolved = resolveWithinRoot(filePath, options?.rootDir);
      const stat = await fsPromises.stat(resolved);
      if (!stat.isFile()) throw new Error(`not a regular file: ${filePath}`);
      const maxBytes = options?.maxBytes;
      if (maxBytes != null && stat.size > maxBytes) {
        throw new Error(`file too large: ${stat.size} > ${maxBytes}`);
      }
      return fsPromises.readFile(resolved);
    },
    statRegularFileSync(filePath, rootDir) {
      const resolved = resolveWithinRoot(filePath, rootDir);
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) throw new Error(`not a regular file: ${filePath}`);
      return stat;
    },
    async writeExternalFileWithinRoot({ rootDir, relativePath, data }) {
      const root = path.resolve(rootDir);
      const target = resolveWithinRoot(path.join(root, relativePath), root);
      await fsPromises.mkdir(path.dirname(target), { recursive: true });
      await fsPromises.writeFile(target, data);
      return target;
    },
    safeEqualSecret(a, b) {
      const ba = Buffer.from(a);
      const bb = Buffer.from(b);
      if (ba.length !== bb.length) return false;
      return crypto.timingSafeEqual(ba, bb);
    },
  };
}

/** 单例缓存：避免重复加载 OpenClaw security-runtime */
let cachedGuard: Promise<PathGuardApi> | null = null;

/**
 * 获取路径守卫 API（单例缓存）。
 *
 * 优先使用 OpenClaw `security-runtime` SDK；不可用时降级为 {@link createLocalPathGuard}。
 *
 * @returns 路径守卫实例
 *
 * @example
 * ```ts
 * const guard = await getPathGuard();
 * const buf = await guard.readRegularFile("/data/inbound/a.png", { maxBytes: 10_000_000 });
 * ```
 */
export async function getPathGuard(): Promise<PathGuardApi> {
  if (!cachedGuard) {
    cachedGuard = (async () => {
      const sdk = await importOpenClawPluginSdk<PathGuardApi>("security-runtime");
      if (
        sdk &&
        typeof sdk.readRegularFile === "function" &&
        typeof sdk.safeEqualSecret === "function"
      ) {
        return sdk;
      }
      return createLocalPathGuard();
    })();
  }
  return cachedGuard;
}

export { createLocalPathGuard };
