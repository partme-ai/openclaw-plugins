/**
 * KF 入站 msgid 去重单元测试
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  claimWecomKfInboundMsgid,
  commitWecomKfInboundMsgid,
  releaseWecomKfInboundMsgid,
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

  it("只有 commit 后才把重复 msgid 标记为已处理", async () => {
    expect((await claimWecomKfInboundMsgid("wk_001", "msg-100")).kind).toBe("claimed");
    expect((await claimWecomKfInboundMsgid("wk_001", "msg-100")).kind).toBe("inflight");
    await commitWecomKfInboundMsgid("wk_001", "msg-100");
    expect((await claimWecomKfInboundMsgid("wk_001", "msg-100")).kind).toBe("duplicate");
  });

  it("不同 open_kfid 的相同 msgid 应独立去重", async () => {
    expect((await claimWecomKfInboundMsgid("wk_a", "msg-dup")).kind).toBe("claimed");
    expect((await claimWecomKfInboundMsgid("wk_b", "msg-dup")).kind).toBe("claimed");
  });

  it("空 msgid 返回 invalid，由调用方按无去重键处理", async () => {
    expect((await claimWecomKfInboundMsgid("wk_001", "")).kind).toBe("invalid");
    expect((await claimWecomKfInboundMsgid("wk_001", "   ")).kind).toBe("invalid");
  });

  it("处理失败 release 后允许同一 msgid 重试", async () => {
    expect((await claimWecomKfInboundMsgid("wk_001", "msg-retry")).kind).toBe("claimed");
    await releaseWecomKfInboundMsgid("wk_001", "msg-retry", new Error("dispatch failed"));
    expect((await claimWecomKfInboundMsgid("wk_001", "msg-retry")).kind).toBe("claimed");
  });
});
