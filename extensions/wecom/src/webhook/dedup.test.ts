import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimWecomAgentInboundMsgid,
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

describe("claimWecomAgentInboundMsgid", () => {
  const prevStateDir = process.env.OPENCLAW_STATE_DIR;

  beforeEach(() => {
    resetWecomWebhookDedupeForTests();
    process.env.OPENCLAW_STATE_DIR = path.join(
      os.tmpdir(),
      `wecom-agent-dedup-test-${process.pid}-${Date.now()}`,
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
    expect(await claimWecomAgentInboundMsgid("acct-a", "agent-msg-100")).toBe(true);
    expect(await claimWecomAgentInboundMsgid("acct-a", "agent-msg-100")).toBe(false);
  });

  it("isolates agent namespace from webhook for same msgid", async () => {
    expect(await claimWecomInboundMsgid("acct-a", "shared-msg-1")).toBe(true);
    expect(await claimWecomAgentInboundMsgid("acct-a", "shared-msg-1")).toBe(true);
  });

  it("persists claim across dedupe singleton reset and reload", async () => {
    expect(await claimWecomAgentInboundMsgid("acct-a", "agent-msg-persist")).toBe(true);
    resetWecomWebhookDedupeForTests();
    expect(await claimWecomAgentInboundMsgid("acct-a", "agent-msg-persist")).toBe(false);
  });
});
