/**
 * media-path-guard 单元测试
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getExtendedMediaLocalRoots,
  readGuardedLocalMediaFile,
  resolveAllowedRootForLocalPath,
  _resetMediaPathGuardCacheForTests,
} from "./media-path-guard.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  _resetMediaPathGuardCacheForTests();
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("resolveAllowedRootForLocalPath", () => {
  it("允许白名单根目录内的文件", async () => {
    const root = await makeTempDir("wecom-guard-root-");
    const file = path.join(root, "photo.png");
    await fs.writeFile(file, "png-data");

    const matched = await resolveAllowedRootForLocalPath(file, [root]);
    expect(matched).toBe(await fs.realpath(root));
  });

  it("拒绝白名单外的路径", async () => {
    const root = await makeTempDir("wecom-guard-root-");
    const outside = path.join(os.tmpdir(), `wecom-guard-outside-${Date.now()}.txt`);
    await fs.writeFile(outside, "secret");
    tempDirs.push(outside);

    const matched = await resolveAllowedRootForLocalPath(outside, [root]);
    expect(matched).toBeUndefined();
  });
});

describe("readGuardedLocalMediaFile", () => {
  it("在白名单内成功读取文件", async () => {
    const root = await makeTempDir("wecom-guard-read-");
    const file = path.join(root, "note.txt");
    await fs.writeFile(file, "hello");

    const result = await readGuardedLocalMediaFile({
      filePath: file,
      allowedRoots: [root],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.buffer.toString("utf8")).toBe("hello");
    }
  });

  it("路径非法时返回 not allowed 且不抛异常", async () => {
    const root = await makeTempDir("wecom-guard-read-");
    const outside = path.join(os.tmpdir(), `wecom-guard-deny-${Date.now()}.txt`);
    await fs.writeFile(outside, "deny");
    tempDirs.push(outside);

    const result = await readGuardedLocalMediaFile({
      filePath: outside,
      allowedRoots: [root],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejectReason).toBe("not allowed");
      expect(result.error).toContain("not under an allowed directory");
    }
  });
});

describe("getExtendedMediaLocalRoots", () => {
  it("合并默认根、stateDir 与 mediaLocalRoots", async () => {
    const customRoot = await makeTempDir("wecom-guard-custom-");
    const roots = await getExtendedMediaLocalRoots({
      mediaLocalRoots: [customRoot],
    });

    const resolvedCustomRoot = await fs.realpath(customRoot);
    expect(roots).toContain(resolvedCustomRoot);
    expect(roots.length).toBeGreaterThan(1);
  });

  it("returns cached roots for identical config without recomputing", async () => {
    const customRoot = await makeTempDir("wecom-guard-cache-");
    const config = { mediaLocalRoots: [customRoot] };

    const first = await getExtendedMediaLocalRoots(config);
    const second = await getExtendedMediaLocalRoots(config);

    expect(second).toBe(first);
  });
});
