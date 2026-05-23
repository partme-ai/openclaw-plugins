/**
 * KF 入站 msgid 去重单元测试
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  claimWecomKfInboundMsgid,
  resetWecomKfInboundDedupeForTests,
  resolveKfInboundDedupeNamespace,
} from "../dedup/kf-inbound-dedup.js";

describe("resolveKfInboundDedupeNamespace", () => {
  it("应生成 wecom-kf-inbound:{openKfId} namespace", () => {
    expect(resolveKfInboundDedupeNamespace("wk_presale_001")).toBe(
      "wecom-kf-inbound:wk_presale_001",
    );
    expect(resolveKfInboundDedupeNamespace("")).toBe("wecom-kf-inbound:default");
  });
});

describe("claimWecomKfInboundMsgid", () => {
  const prevStateDir = process.env.OPENCLAW_STATE_DIR;

  beforeEach(() => {
    resetWecomKfInboundDedupeForTests();
    process.env.OPENCLAW_STATE_DIR = path.join(
      os.tmpdir(),
      `wecom-kf-dedup-test-${process.pid}-${Date.now()}`,
    );
  });

  afterEach(async () => {
    const dir = process.env.OPENCLAW_STATE_DIR;
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (prevStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = prevStateDir;
    resetWecomKfInboundDedupeForTests();
  });

  it("首次 claim 应成功，重复 msgid 应拒绝", async () => {
    expect(await claimWecomKfInboundMsgid("wk_001", "msg-100")).toBe(true);
    expect(await claimWecomKfInboundMsgid("wk_001", "msg-100")).toBe(false);
  });

  it("不同 open_kfid 的相同 msgid 应独立去重", async () => {
    expect(await claimWecomKfInboundMsgid("wk_a", "msg-dup")).toBe(true);
    expect(await claimWecomKfInboundMsgid("wk_b", "msg-dup")).toBe(true);
  });

  it("空 msgid 应视为可处理", async () => {
    expect(await claimWecomKfInboundMsgid("wk_001", "")).toBe(true);
    expect(await claimWecomKfInboundMsgid("wk_001", "   ")).toBe(true);
  });
});
