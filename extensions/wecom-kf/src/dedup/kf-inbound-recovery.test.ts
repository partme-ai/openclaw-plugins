import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  getKfInboundRecovery,
  putKfInboundRecovery,
  resolveKfInboundRecoveryPath,
} from "./kf-inbound-recovery.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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
