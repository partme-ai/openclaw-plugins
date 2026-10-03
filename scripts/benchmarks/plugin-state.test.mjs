import assert from "node:assert/strict";
import { test } from "node:test";

import { generateDataset, summarizeSamples, evaluateCapacity, runGroup } from "./plugin-state.mjs";

test("same seed and count yield identical anonymous records and hash", () => {
  const first = generateDataset({ seed: 20260929, count: 12 });
  const second = generateDataset({ seed: 20260929, count: 12 });
  assert.deepEqual(first, second);
  assert.equal(first.records.length, 12);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.ok(first.records.every((record) => !JSON.stringify(record).includes("@")));
});

test("a different seed changes the dataset hash", () => {
  assert.notEqual(
    generateDataset({ seed: 20260929, count: 12 }).hash,
    generateDataset({ seed: 20260930, count: 12 }).hash,
  );
});

test("invalid scale and configured capacity are explicit rejections", () => {
  assert.throws(() => generateDataset({ seed: 1, count: -1 }), /count/);
  assert.deepEqual(evaluateCapacity({ kind: "router", count: 101, limit: 100, bytes: 1 }), {
    accepted: false,
    reason: "configured-capacity",
    limit: 100,
  });
  assert.deepEqual(evaluateCapacity({ kind: "memory", count: 10, limit: 100, bytes: 101 }), {
    accepted: false,
    reason: "search-byte-budget",
    limit: 100,
  });
});

test("failed samples stay visible and never become zero latency", () => {
  const result = summarizeSamples([
    { ok: true, durationMs: 10, bytesWritten: 5, bytesScanned: 7, eventLoopDelayMs: 2 },
    { ok: false, error: "capacity reached" },
    { ok: true, durationMs: 20, bytesWritten: 6, bytesScanned: 8, eventLoopDelayMs: 3 },
  ], 1);
  assert.equal(result.sampleCount, 3);
  assert.equal(result.successCount, 2);
  assert.equal(result.failureCount, 1);
  assert.equal(result.p50Ms, 15);
  assert.equal(result.p95Ms, 19.5);
  assert.equal(result.bytesWritten, 11);
  assert.equal(result.bytesScanned, 15);
  assert.equal(result.throughputPerSec, 66.666667);
});

test("small groups exercise actual MemoryStore and DurableRouteStore", async () => {
  const memory = await runGroup({ kind: "memory", seed: 9, count: 8, runs: 5 });
  const router = await runGroup({ kind: "router", seed: 9, count: 8, runs: 5 });
  for (const group of [memory, router]) {
    assert.equal(group.status, "measured");
    assert.equal(group.samples.length, 5);
    assert.equal(group.summary.successCount, 5);
    assert.ok(group.samples.every((sample) => sample.ok && sample.durationMs > 0));
    assert.ok(group.datasetHash);
  }
  assert.ok(memory.summary.bytesScanned > 0);
  assert.ok(router.summary.bytesWritten > 0);
});
