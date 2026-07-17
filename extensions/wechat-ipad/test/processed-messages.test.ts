import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveWechatIpadProcessedMessagesPath,
  WechatIpadProcessedMessageStore,
} from "../src/storage/processed-messages.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("WechatIpadProcessedMessageStore", () => {
  it("recovers successful message ids across restarts with private permissions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-ipad-state-"));
    temporaryDirectories.push(root);
    const filePath = resolveWechatIpadProcessedMessagesPath({ OPENCLAW_STATE_DIR: root });

    const now = Date.now();
    new WechatIpadProcessedMessageStore(filePath).mark("message-1", now);
    const restored = new WechatIpadProcessedMessageStore(filePath, 10_000, 10);

    expect(restored.has("message-1", now + 1_000)).toBe(true);
    expect(fs.statSync(path.dirname(filePath)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it("ignores a corrupt tail and expires old records", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-ipad-state-"));
    temporaryDirectories.push(root);
    const filePath = path.join(root, "processed.jsonl");
    const now = Date.now();
    fs.writeFileSync(filePath, `${JSON.stringify({ id: "valid", seenAt: now })}\n{"id":`);

    const restored = new WechatIpadProcessedMessageStore(filePath, 100, 10);
    expect(restored.has("valid", now + 50)).toBe(true);
    expect(restored.has("valid", now + 101)).toBe(false);
  });
});
