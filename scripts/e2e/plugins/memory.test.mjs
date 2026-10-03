import assert from "node:assert/strict";
import { test } from "node:test";

import * as adapter from "./memory.mjs";

test("memory hit proof requires this tool call's marker and memory citation", () => {
  assert.equal(typeof adapter.findMemoryToolResult, "function");
  const messages = [{ role: "tool", tool_call_id: "same-call", content: "1. private-current-run (sessions/opaque/memories/day.jsonl#L1)" }];
  assert.equal(adapter.findMemoryToolResult(messages, "same-call", "private-current-run"), messages[0]);
  assert.throws(() => adapter.findMemoryToolResult(messages, "other-call", "private-current-run"), /tool result/i);
  assert.throws(() => adapter.findMemoryToolResult(messages, "same-call", "another-run"), /tool result/i);
});

test("memory hit proof rejects transcript-only text and error echoes", () => {
  assert.equal(typeof adapter.findMemoryToolResult, "function");
  assert.throws(() => adapter.findMemoryToolResult([{ role: "user", content: "private-current-run (sessions/opaque/memories/day.jsonl#L1)" }], "same-call", "private-current-run"), /tool result/i);
  assert.throws(() => adapter.findMemoryToolResult([{ role: "tool", tool_call_id: "same-call", content: "Error: search failed for private-current-run" }], "same-call", "private-current-run"), /tool result/i);
});

test("memory isolation proof requires explicit empty tool receipt, not missing tool or error", () => {
  assert.equal(typeof adapter.findMemoryToolResult, "function");
  const receipt = { role: "tool", tool_call_id: "other-call", content: [{ type: "text", text: "未找到相关记忆。" }] };
  assert.equal(adapter.findMemoryToolResult([receipt], "other-call"), receipt);
  assert.throws(() => adapter.findMemoryToolResult([{ ...receipt, role: "user" }], "other-call"), /tool result/i);
  assert.throws(() => adapter.findMemoryToolResult([{ ...receipt, content: "Error: 未找到相关记忆。" }], "other-call"), /tool result/i);
  assert.throws(() => adapter.findMemoryToolResult([{ ...receipt, content: "1. leaked (sessions/opaque/memories/day.jsonl#L1)" }], "other-call"), /tool result/i);
});
