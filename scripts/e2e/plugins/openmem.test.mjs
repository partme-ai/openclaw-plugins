import assert from "node:assert/strict";
import { test } from "node:test";

import { assertStableCommitReplay, findRunSession } from "./openmem.mjs";

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
