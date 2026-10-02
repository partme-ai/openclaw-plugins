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
