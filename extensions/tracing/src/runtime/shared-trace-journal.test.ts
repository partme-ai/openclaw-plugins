import { mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { Span } from "../shared/types.js";
import { SharedTraceJournal } from "./shared-trace-journal.js";

const dirs: string[] = [];
const traceId = "a".repeat(32);
function span(index: number, id = traceId): Span {
  return { traceId: id, spanId: index.toString(16).padStart(16, "0"), name: `span-${index}`,
    kind: "internal", startTimeMs: index, endTimeMs: index + 1, status: "ok", attributes: {}, events: [] };
}
async function journal(options: { maxTraces?: number; maxSpansPerTrace?: number; retentionMs?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "trace-journal-test-"));
  dirs.push(dir);
  return { dir, store: new SharedTraceJournal(dir, options) };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("cross-runtime completed trace journal", () => {
  it("redacts raw identifiers before persisting completed spans", async () => {
    const { store } = await journal();
    await store.writeSpan({ ...span(1), attributes: { "openclaw.session_key": "raw-session-secret" } });
    expect((await store.get(traceId))?.[0]?.attributes["openclaw.session_key"]).toBe("[REDACTED]");
  });

  it("transactionally shares completed spans across instances and survives restart", async () => {
    const { dir, store } = await journal();
    await Promise.all([store.writeSpan(span(1)), store.writeSpan(span(2)), store.writeSpan(span(1))]);
    const gateway = new SharedTraceJournal(dir);
    expect(await gateway.count()).toBe(1);
    expect((await gateway.get(traceId))?.map((item) => item.spanId)).toEqual([
      "0000000000000001", "0000000000000002",
    ]);
    expect(await gateway.list(10)).toMatchObject([{ traceId, spanCount: 2 }]);
    expect((await stat(join(dir, "journal.sqlite"))).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it("enforces trace and span capacity and retention on restart", async () => {
    const { dir, store } = await journal({ maxTraces: 2, maxSpansPerTrace: 2, retentionMs: 1_000 });
    await store.writeSpan(span(1));
    await store.writeSpan(span(2));
    await expect(store.writeSpan(span(3))).rejects.toThrow(/span capacity/);
    const db = new DatabaseSync(join(dir, "journal.sqlite"));
    db.prepare("UPDATE traces SET updated_at = 0 WHERE trace_id = ?").run(traceId);
    db.close();
    const restarted = new SharedTraceJournal(dir, { maxTraces: 2, maxSpansPerTrace: 2, retentionMs: 1_000 });
    expect(await restarted.count()).toBe(0);
    await restarted.writeSpan(span(1, "b".repeat(32)));
    await restarted.writeSpan(span(1, "c".repeat(32)));
    await restarted.writeSpan(span(1, "d".repeat(32)));
    expect(await restarted.count()).toBe(2);
    await expect(restarted.get("../../etc/passwd")).rejects.toThrow(/traceId/);
  });

  it("rejects database and parent symlinks before writing outside the profile", async () => {
    const { dir, store } = await journal();
    const external = await mkdtemp(join(tmpdir(), "trace-journal-target-"));
    dirs.push(external);
    await writeFile(join(external, "outside.sqlite"), "untouched");
    await symlink(join(external, "outside.sqlite"), join(dir, "journal.sqlite"));
    await expect(store.writeSpan(span(1))).rejects.toThrow(/symlink/);
    expect(await readdir(external)).toEqual(["outside.sqlite"]);

    const scope = await mkdtemp(join(tmpdir(), "trace-journal-scope-"));
    dirs.push(scope);
    await symlink(external, join(scope, "plugins"));
    const nested = new SharedTraceJournal(join(scope, "plugins", "tracing", "journal"), { scopeRoot: scope });
    await expect(nested.writeSpan(span(1))).rejects.toThrow(/symlink/);
    expect(await readdir(external)).toEqual(["outside.sqlite"]);
  });

  it("rejects path escape before creating any journal files", async () => {
    const scope = await mkdtemp(join(tmpdir(), "trace-journal-scope-"));
    dirs.push(scope);
    const outside = new SharedTraceJournal(join(scope, "..", "escaped-journal"), { scopeRoot: scope });
    await expect(outside.writeSpan(span(1))).rejects.toThrow(/escaped/);
  });

  it("keeps a global trace cap under concurrent writers from separate runtimes", async () => {
    const { dir, store } = await journal({ maxTraces: 2 });
    const second = new SharedTraceJournal(dir, { maxTraces: 2 });
    await Promise.all(Array.from({ length: 12 }, (_, index) => {
      const id = index.toString(16).padStart(32, "0");
      return (index % 2 ? store : second).writeSpan(span(index, id));
    }));
    expect(await second.count()).toBe(2);
    expect((await second.list(200)).length).toBe(2);
  });

  it("HTTP-style reads do not acquire the SQLite writer lock", async () => {
    const { dir, store } = await journal();
    await store.writeSpan(span(1));
    const writer = new DatabaseSync(join(dir, "journal.sqlite"));
    writer.exec("BEGIN IMMEDIATE");
    try {
      const started = Date.now();
      expect(await store.count()).toBe(1);
      expect(await store.list(10)).toMatchObject([{ traceId }]);
      expect((await store.get(traceId))?.length).toBe(1);
      expect(Date.now() - started).toBeLessThan(500);
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
  });

  it("startup prepare recovers an interrupted writer transaction", async () => {
    const { dir, store } = await journal();
    await store.prepare();
    const child = spawnSync(process.execPath, ["-e", `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]);
      db.exec('BEGIN IMMEDIATE');
      db.prepare("INSERT INTO traces VALUES (?, 1, 0, 0, 0, '(unknown)')").run('${traceId}');
      process.exit(0);
    `, join(dir, "journal.sqlite")], { encoding: "utf8" });
    expect(child.status).toBe(0);
    const restarted = new SharedTraceJournal(dir);
    await restarted.prepare();
    expect(await restarted.count()).toBe(0);
  });
});
