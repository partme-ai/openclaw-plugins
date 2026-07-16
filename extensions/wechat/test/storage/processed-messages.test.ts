import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProcessedMessageStore } from "../../src/storage/processed-messages.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function filePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-dedupe-"));
  dirs.push(dir);
  return path.join(dir, "processed.json");
}

describe("ProcessedMessageStore", () => {
  it("persists completed message ids across restarts", () => {
    const file = filePath();
    const now = Date.now();
    new ProcessedMessageStore(file).mark("message-1", now);
    expect(new ProcessedMessageStore(file, 10_000).has("message-1", now + 1_000)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("expires old entries and bounds retained entries", () => {
    const file = filePath();
    const now = Date.now();
    const store = new ProcessedMessageStore(file, 100, 2);
    store.mark("old", now - 1_000);
    store.mark("one", now);
    store.mark("two", now + 1);
    store.mark("three", now + 2);
    expect(store.has("old", now + 2)).toBe(false);
    expect(store.has("one", now + 2)).toBe(false);
    expect(store.has("two", now + 2)).toBe(true);
    expect(store.has("three", now + 2)).toBe(true);
  });

  it("fails open when persisted state is corrupt", () => {
    const file = filePath();
    fs.writeFileSync(file, "not-json");
    expect(new ProcessedMessageStore(file).has("message-1")).toBe(false);
  });
});
