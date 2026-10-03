import assert from "node:assert/strict";
import { test } from "node:test";

import { assertStableCommitReplay, findRunSession, findToolResultMessage } from "./openmem.mjs";

test("selects only the session with this run's event marker", async () => {
  const sessions = [
    { session_id: "old", agent_id: "main", event_count: 2 },
    { session_id: "current", agent_id: "main", event_count: 1 },
  ];
  const readEvents = async (sessionId) => ({ events: [{ content: sessionId === "old" ? "海盐蓝 old-run" : "海盐蓝 unique-current-run" }] });
  assert.equal((await findRunSession(sessions, "unique-current-run", readEvents))?.session_id, "current");
  assert.equal(await findRunSession(sessions, "another-run", readEvents), undefined);
});

test("replayed commit requires nonempty fact memory IDs and exact ID stability", () => {
  const commit = (memories) => ({ archive: { archive_id: "archive-1" }, memories });
  assert.throws(() => assertStableCommitReplay(commit([]), commit([])), /memory/i);
  assert.throws(() => assertStableCommitReplay(commit([{}]), commit([{}])), /memory/i);
  assert.throws(() => assertStableCommitReplay(commit([{ memory_id: "m1" }]), commit([{ memory_id: "m2" }])), /memory/i);
  assert.doesNotThrow(() => assertStableCommitReplay(commit([{ memory_id: "m1" }]), commit([{ memory_id: "m1" }])));
});

test("tool result proof cannot be satisfied by user transcript text", () => {
  const messages = [
    { role: "user", content: "海盐蓝" },
    { role: "tool", tool_call_id: "call_other", content: "海盐蓝" },
  ];
  assert.throws(() => findToolResultMessage(messages, "callopenmeme2e", "海盐蓝"), /tool result/i);
  messages.push({ role: "tool", tool_call_id: "callopenmeme2e", content: "1. 海盐蓝 (openmem/archive/archive-1#L1)" });
  assert.equal(findToolResultMessage(messages, "callopenmeme2e", "海盐蓝"), messages[2]);
});

test("tool result proof rejects an error echoing the search query", () => {
  const messages = [{
    role: "tool",
    tool_call_id: "callopenmeme2e",
    content: "Error: OpenMem search failed for query 海盐蓝",
  }];
  assert.throws(() => findToolResultMessage(messages, "callopenmeme2e", "海盐蓝"), /tool result/i);
});

test("empty OpenMem tool receipt proves isolation and cannot be replaced by transcript or error", async () => {
  const { findEmptyToolResultMessage } = await import("./openmem.mjs");
  assert.equal(typeof findEmptyToolResultMessage, "function");
  const receipt = { role: "tool", tool_call_id: "isolated-call", content: "未找到 OpenMem 记忆。" };
  assert.equal(findEmptyToolResultMessage([receipt], "isolated-call"), receipt);
  assert.throws(() => findEmptyToolResultMessage([{ ...receipt, role: "user" }], "isolated-call"), /tool result/i);
  assert.throws(() => findEmptyToolResultMessage([receipt], "another-call"), /tool result/i);
  assert.throws(() => findEmptyToolResultMessage([{ ...receipt, content: "Error: 未找到 OpenMem 记忆。" }], "isolated-call"), /tool result/i);
  assert.throws(() => findEmptyToolResultMessage([{ ...receipt, content: "1. leaked (openmem/archive/a#L1)" }], "isolated-call"), /tool result/i);
});

test("OpenMem hit proof rejects an older run even when fact text and citation are present", () => {
  const messages = [{ role: "tool", tool_call_id: "current-call", content: "1. 海盐蓝 previous-run (openmem/archive/a#L1)" }];
  assert.throws(() => findToolResultMessage(messages, "current-call", "unique-current-run"), /tool result/i);
});

test("shutdown archives the ended session and preserves an unended logical session", async () => {
  const { assertShutdownSessionBoundary } = await import("./openmem.mjs");
  assert.equal(typeof assertShutdownSessionBoundary, "function");
  const sessions = [
    { session_id: "ended", status: "ARCHIVED" },
    { session_id: "continuing", status: "ACTIVE" },
  ];
  assert.doesNotThrow(() => assertShutdownSessionBoundary(sessions, "ended", "continuing"));
  assert.throws(() => assertShutdownSessionBoundary([{ session_id: "ended", status: "ACTIVE" }, sessions[1]], "ended", "continuing"), /shutdown boundary/i);
  assert.throws(() => assertShutdownSessionBoundary([sessions[0]], "ended", "continuing"), /shutdown boundary/i);
  assert.throws(() => assertShutdownSessionBoundary([sessions[0], { session_id: "continuing", status: "ARCHIVED" }], "ended", "continuing"), /shutdown boundary/i);
  assert.throws(() => assertShutdownSessionBoundary(sessions, "missing", "continuing"), /shutdown boundary/i);
});
