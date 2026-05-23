import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimWecomInboundMsgid,
  resetWecomWebhookDedupeForTests,
} from "./dedup.js";

describe("claimWecomInboundMsgid", () => {
  const prevStateDir = process.env.OPENCLAW_STATE_DIR;

  beforeEach(() => {
    resetWecomWebhookDedupeForTests();
    process.env.OPENCLAW_STATE_DIR = path.join(
      os.tmpdir(),
      `wecom-dedup-test-${process.pid}-${Date.now()}`,
    );
  });

  afterEach(async () => {
    const dir = process.env.OPENCLAW_STATE_DIR;
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (prevStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = prevStateDir;
    resetWecomWebhookDedupeForTests();
  });

  it("claims first msgid and rejects duplicate", async () => {
    expect(await claimWecomInboundMsgid("acct-a", "msg-100")).toBe(true);
    expect(await claimWecomInboundMsgid("acct-a", "msg-100")).toBe(false);
  });

  it("isolates namespaces per account", async () => {
    expect(await claimWecomInboundMsgid("acct-a", "msg-1")).toBe(true);
    expect(await claimWecomInboundMsgid("acct-b", "msg-1")).toBe(true);
  });
});
