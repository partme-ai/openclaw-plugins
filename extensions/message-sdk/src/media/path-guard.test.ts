/**
 * path-guard.test.ts — 媒体路径、指令、下载、读取与出站解析工具。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalPathGuard } from "./path-guard.js";

describe("createLocalPathGuard", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
    tmpDirs.length = 0;
  });

  it("reads file within root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "path-guard-"));
    tmpDirs.push(root);
    const file = path.join(root, "a.txt");
    await fs.writeFile(file, "hello", "utf8");

    const guard = createLocalPathGuard();
    const buf = await guard.readRegularFile(file, { rootDir: root });
    expect(buf.toString("utf8")).toBe("hello");
  });

  it("rejects path traversal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "path-guard-"));
    tmpDirs.push(root);
    const guard = createLocalPathGuard();
    await expect(
      guard.readRegularFile(path.join(root, "..", "outside.txt"), { rootDir: root }),
    ).rejects.toThrow(/escapes root/);
  });

  it("compares secrets with timingSafeEqual", () => {
    const guard = createLocalPathGuard();
    expect(guard.safeEqualSecret("abc", "abc")).toBe(true);
    expect(guard.safeEqualSecret("abc", "abd")).toBe(false);
  });
});
