import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DurableJsonMapStore } from "./durable-json-map.js";

describe("DurableJsonMapStore", () => {
  let storeDir = "";

  beforeEach(async () => {
    storeDir = await mkdtemp(join(tmpdir(), "wecom-kf-state-"));
  });

  afterEach(async () => {
    await rm(storeDir, { recursive: true, force: true });
  });

  it("原子持久化并收紧既有状态目录和文件权限", async () => {
    await chmod(storeDir, 0o777);
    const store = new DurableJsonMapStore<{ state: string }>("session/state.json", storeDir);

    await store.set("session-1", { state: "serving" });

    const stateDir = join(storeDir, "session");
    const filePath = join(stateDir, "state.json");
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      "session-1": { state: "serving" },
    });
    expect((await stat(stateDir)).mode & 0o777).toBe(0o700);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("重启后恢复 JSON 状态", async () => {
    const first = new DurableJsonMapStore<number>("counter.json", storeDir);
    await first.set("messages", 3);

    const restored = new DurableJsonMapStore<number>("counter.json", storeDir);
    await restored.load();

    expect(restored.get("messages")).toBe(3);
  });
});
