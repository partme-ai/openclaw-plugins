/**
 * 路径沙箱：优先 OpenClaw security-runtime，否则受限本地实现。
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { importOpenClawPluginSdk } from "../openclaw-loader.js";

export type PathGuardReadOptions = {
  maxBytes?: number;
  rootDir?: string;
};

export type PathGuardApi = {
  readRegularFile: (filePath: string, options?: PathGuardReadOptions) => Promise<Buffer>;
  statRegularFileSync: (filePath: string, rootDir?: string) => fs.Stats;
  writeExternalFileWithinRoot: (params: {
    rootDir: string;
    relativePath: string;
    data: Buffer | string;
  }) => Promise<string>;
  safeEqualSecret: (a: string, b: string) => boolean;
};

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

let cachedGuard: Promise<PathGuardApi> | null = null;

/**
 * 获取路径守卫 API（单例缓存）。
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
