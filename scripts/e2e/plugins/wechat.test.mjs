import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { waitForWechatMessageSettlement } from "./wechat.mjs";

test("media rejection waits for the exact message ID to settle after the model finishes", async () => {
  const root = mkdtempSync(join(tmpdir(), "wechat-settlement-"));
  const journal = join(root, "processed.jsonl");
  const metrics = { completionsFinished: 4 };
  const checks = [];
  try {
    await waitForWechatMessageSettlement(async (condition) => {
      checks.push(await condition());
      writeFileSync(journal, `${JSON.stringify({ id: "other-message", seenAt: Date.now() })}\n`);
      metrics.completionsFinished = 5;
      checks.push(await condition());
      appendFileSync(journal, `${JSON.stringify({ id: "wechat-e2e-media-escape-test", seenAt: Date.now() })}\n`);
      checks.push(await condition());
    }, metrics, 4, "wechat-e2e-media-escape-test", journal);
    assert.deepEqual(checks, [false, false, true]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
