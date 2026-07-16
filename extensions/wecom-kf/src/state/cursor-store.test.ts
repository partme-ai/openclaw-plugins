import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getCursorStore, initCursorStore, resetCursorStoreForTests } from "./cursor-store.js";

describe("CursorStore", () => {
  let storeDir = "";

  beforeEach(async () => {
    storeDir = await mkdtemp(join(tmpdir(), "wecom-kf-cursor-"));
    initCursorStore(storeDir);
  });

  afterEach(async () => {
    resetCursorStoreForTests();
    await rm(storeDir, { recursive: true, force: true });
  });

  it("原子持久化游标并限制文件权限", async () => {
    await getCursorStore().saveCursor("default:kf_001", "cursor-1");
    const digest = createHash("sha256").update("default:kf_001").digest("hex").slice(0, 16);
    const filePath = join(storeDir, `default_kf_001-${digest}.cursor`);
    expect(await readFile(filePath, "utf8")).toBe("cursor-1\n");
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("字符替换结果相同的账号键不会发生游标文件碰撞", async () => {
    await getCursorStore().saveCursor("account:a", "cursor-a");
    await getCursorStore().saveCursor("account?a", "cursor-b");
    resetCursorStoreForTests();
    initCursorStore(storeDir);
    expect(await getCursorStore().getCursor("account:a")).toBe("cursor-a");
    expect(await getCursorStore().getCursor("account?a")).toBe("cursor-b");
  });

  it("兼容读取旧版文件名", async () => {
    await writeFile(join(storeDir, "default_kf_001.cursor"), "legacy-cursor\n", { mode: 0o600 });
    expect(await getCursorStore().getCursor("default:kf_001")).toBe("legacy-cursor");
  });

  it("游标文件损坏时失败而不是静默从空游标重放", async () => {
    const key = "default:kf_001";
    const digest = createHash("sha256").update(key).digest("hex").slice(0, 16);
    await writeFile(join(storeDir, `default_kf_001-${digest}.cursor`), "   \n", { mode: 0o600 });
    await expect(getCursorStore().getCursor(key)).rejects.toThrow("cursor file is empty");
  });

  it("并发保存按调用顺序串行，最终值不会回退", async () => {
    await Promise.all([
      getCursorStore().saveCursor("default:kf_001", "cursor-1"),
      getCursorStore().saveCursor("default:kf_001", "cursor-2"),
    ]);
    expect(await getCursorStore().getCursor("default:kf_001")).toBe("cursor-2");
  });

  it("拒绝空游标且保留原值", async () => {
    await getCursorStore().saveCursor("default:kf_001", "cursor-1");
    await expect(getCursorStore().saveCursor("default:kf_001", "   ")).rejects.toThrow("must not be empty");
    expect(await getCursorStore().getCursor("default:kf_001")).toBe("cursor-1");
  });
});
