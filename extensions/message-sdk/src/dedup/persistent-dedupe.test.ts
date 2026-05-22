/**
 * persistent-dedupe.test.ts — 入站消息幂等、持久化去重与并发 claim/release 保护。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalPersistentDedupeSync } from "./persistent-dedupe.js";

describe("createLocalPersistentDedupeSync", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
    tmpDirs.length = 0;
  });

  it("records first key and rejects duplicate within TTL", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "msg-dedup-"));
    tmpDirs.push(dir);
    const dedupe = createLocalPersistentDedupeSync({
      ttlMs: 60_000,
      memoryMaxSize: 100,
      fileMaxEntries: 100,
      resolveFilePath: (ns) => path.join(dir, `${ns}.json`),
    });

    expect(await dedupe.checkAndRecord("msg-1", { namespace: "wecom" })).toBe(true);
    expect(await dedupe.checkAndRecord("msg-1", { namespace: "wecom" })).toBe(false);
    expect(await dedupe.hasRecent("msg-1", { namespace: "wecom" })).toBe(true);
  });

  it("warmup loads disk entries into memory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "msg-dedup-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "global.json");
    const now = Date.now();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, JSON.stringify({ "global:k1": now }), "utf8");

    const dedupe = createLocalPersistentDedupeSync({
      ttlMs: 60_000,
      memoryMaxSize: 100,
      fileMaxEntries: 100,
      resolveFilePath: () => file,
    });

    const warmed = await dedupe.warmup("global");
    expect(warmed).toBeGreaterThanOrEqual(1);
    expect(await dedupe.hasRecent("k1", { namespace: "global" })).toBe(true);
  });
});
