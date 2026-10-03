import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const diskFaults = vi.hoisted(() => ({ failNextRecoveryRename: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      if (diskFaults.failNextRecoveryRename && String(args[1]).includes("inbound-recovery")) {
        diskFaults.failNextRecoveryRename = false;
        throw Object.assign(new Error("injected recovery ENOSPC"), { code: "ENOSPC" });
      }
      return fs.rename(...args);
    },
  };
});
import {
  beginKfInboundProcessing,
  completeKfInboundProcessing,
  finishKfInboundProcessing,
  getKfInboundRecovery,
  putKfInboundRecovery,
  resolveKfInboundRecoveryPath,
} from "./kf-inbound-recovery.js";

const dirs: string[] = [];
afterEach(async () => {
  diskFaults.failNextRecoveryRename = false;
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("retains a completed receipt across module reload for the 24-hour dedupe window", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wecom-recovery-"));
  dirs.push(dir);
  const key = { openKfId: "kf-complete", msgId: "msg-complete", stateDir: dir };
  await beginKfInboundProcessing(key);
  await completeKfInboundProcessing(key);
  expect(await getKfInboundRecovery(key)).toMatchObject({ phase: "completed", completedAt: expect.any(Number) });
  vi.resetModules();
  const reloaded = await import("./kf-inbound-recovery.js");
  expect(await reloaded.getKfInboundRecovery(key)).toMatchObject({ phase: "completed" });
  const completedAt = (await getKfInboundRecovery(key))!.completedAt!;
  vi.spyOn(Date, "now").mockReturnValue(completedAt + 24 * 60 * 60 * 1000 + 1);
  expect(await reloaded.getKfInboundRecovery(key)).toBeNull();
  await reloaded.beginKfInboundProcessing({ ...key, msgId: "msg-new" });
  const state = JSON.parse(await readFile(resolveKfInboundRecoveryPath(key.openKfId, dir), "utf8"));
  expect(state.entries).not.toHaveProperty(key.msgId);
});

it("fails closed at 10k unexpired completed entries without evicting them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wecom-recovery-"));
  dirs.push(dir);
  const file = resolveKfInboundRecoveryPath("kf-capacity", dir);
  await mkdir(dirname(file), { recursive: true });
  const now = Date.now();
  const entries = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => {
    const msgId = index.toString(36);
    return [msgId, { msgId, phase: "completed", completedAt: now }];
  }));
  await writeFile(file, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
  await expect(beginKfInboundProcessing({ openKfId: "kf-capacity", msgId: "new", stateDir: dir }))
    .rejects.toThrow("full");
  const unchanged = JSON.parse(await readFile(file, "utf8"));
  expect(Object.keys(unchanged.entries)).toHaveLength(10_000);
  expect(unchanged.entries).not.toHaveProperty("new");
});

it("persists processing before dispatch and clears it only after settlement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wecom-recovery-"));
  dirs.push(dir);
  const key = { openKfId: "kf-processing", msgId: "msg-processing", stateDir: dir };
  await beginKfInboundProcessing(key);
  expect(await getKfInboundRecovery(key)).toMatchObject({ phase: "processing" });
  const file = resolveKfInboundRecoveryPath(key.openKfId, dir);
  expect(JSON.parse(await readFile(file, "utf8")).entries[key.msgId].phase).toBe("processing");
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  await finishKfInboundProcessing(key);
  expect(await getKfInboundRecovery(key)).toBeNull();
});

it("retains memory quarantine after ENOSPC and restart sees durable processing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wecom-recovery-"));
  dirs.push(dir);
  const key = { openKfId: "kf-lost-response", msgId: "msg-lost-response", stateDir: dir };
  await beginKfInboundProcessing(key);
  diskFaults.failNextRecoveryRename = true;
  await expect(putKfInboundRecovery({ ...key, recordState: "recorded", reason: "platform response lost" }))
    .rejects.toMatchObject({ code: "ENOSPC" });
  expect(await getKfInboundRecovery(key)).toMatchObject({ phase: "quarantined", recordState: "recorded" });
  const file = resolveKfInboundRecoveryPath(key.openKfId, dir);
  expect(JSON.parse(await readFile(file, "utf8")).entries[key.msgId].phase).toBe("processing");
  vi.resetModules();
  const reloaded = await import("./kf-inbound-recovery.js");
  expect(await reloaded.getKfInboundRecovery(key)).toMatchObject({ phase: "processing" });
});

it("persists a recorded message for restart review without its body", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wecom-recovery-"));
  dirs.push(dir);
  await putKfInboundRecovery({ openKfId: "kf-1", msgId: "msg-1", recordState: "recorded", reason: "host failed", stateDir: dir });
  expect(await getKfInboundRecovery({ openKfId: "kf-1", msgId: "msg-1", stateDir: dir })).toMatchObject({
    recordState: "recorded", reason: "host failed",
  });
  const file = resolveKfInboundRecoveryPath("kf-1", dir);
  const raw = await readFile(file, "utf8");
  expect(raw).toContain("msg-1");
  expect(raw).not.toContain("customer message body");
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(await getKfInboundRecovery({ openKfId: "kf-2", msgId: "msg-1", stateDir: dir })).toBeNull();
});
