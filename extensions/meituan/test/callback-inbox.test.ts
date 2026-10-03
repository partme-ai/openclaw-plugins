import { mkdtemp, readFile, readdir, rm, utimes } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MeituanCallbackInbox } from "../src/callback/inbox.js";
import type { MeituanNotification } from "../src/callback/parser.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function inbox(maxEntries = 10) {
  const dir = await mkdtemp(join(tmpdir(), "meituan-callback-test-"));
  dirs.push(dir);
  return { dir, store: new MeituanCallbackInbox(dir, maxEntries) };
}
function event(id = "a"): MeituanNotification {
  return { eventId: createHash("sha256").update(id).digest("hex"), businessId: "58", msgType: "5810055", msgId: id,
    developerId: "123", typeName: "verify_order_info_push", kind: "notification", timestamp: 1_700_000_000,
    fingerprint: id.padEnd(64, "f"), payload: { orderId: `order-${id}` }, messageRaw: `{"orderId":"order-${id}"}` };
}

describe("MeituanCallbackInbox", () => {
  it("persists before acknowledging, deduplicates and survives recreation", async () => {
    const { dir, store } = await inbox();
    expect(await store.accept(event())).toBe("created");
    expect(await store.accept(event())).toBe("duplicate");
    const restored = new MeituanCallbackInbox(dir, 10);
    expect(await restored.list(10)).toHaveLength(1);
    expect(await restored.get(event().eventId)).toMatchObject({ payload: { orderId: "order-a" } });
    expect(await readFile(join(dir, `${event().eventId}.json`), "utf8")).not.toContain("signKey");
  });

  it("rejects same id with changed content and fails closed at capacity", async () => {
    const { store } = await inbox(1);
    await store.accept(event());
    await expect(store.accept({ ...event(), fingerprint: "f".repeat(64), payload: { orderId: "tampered" } })).rejects.toThrow("conflict");
    await expect(store.accept(event("b"))).rejects.toThrow("full");
    expect(await store.list(10)).toHaveLength(1);
  });

  it("acknowledges without losing stored content", async () => {
    const { dir, store } = await inbox();
    await store.accept(event());
    expect(await store.ack(event().eventId)).toBe(true);
    expect(await store.list(10)).toHaveLength(0);
    expect(await new MeituanCallbackInbox(dir, 10).get(event().eventId)).toMatchObject({ msgId: "a", acknowledged: true });
  });

  it("does not claim success if the state path cannot be created", async () => {
    const { dir } = await inbox();
    const store = new MeituanCallbackInbox(join(dir, "missing", "nested"), 10);
    // A read-only/invalid path is modeled with a regular file as the parent.
    const blocker = join(dir, "blocker");
    await (await import("node:fs/promises")).writeFile(blocker, "x");
    const blocked = new MeituanCallbackInbox(join(blocker, "nested"), 10);
    await expect(blocked.accept(event())).rejects.toThrow();
    expect(store).toBeDefined();
  });

  it("serializes parallel accepts at the configured capacity", async () => {
    const { store } = await inbox(1);
    const outcomes = await Promise.allSettled([store.accept(event("a")), store.accept(event("b"))]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(await store.list()).toHaveLength(1);
  });

  it("frees pending capacity on ack and prunes old acknowledged records", async () => {
    const { dir, store } = await inbox(1);
    await store.accept(event("a"));
    await store.ack(event("a").eventId);
    expect(await store.accept(event("b"))).toBe("created");
    expect(await store.list()).toMatchObject([{ msgId: "b" }]);
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000);
    await utimes(join(dir, `${event("a").eventId}.json.ack`), old, old);
    const restarted = new MeituanCallbackInbox(dir, 2);
    await restarted.accept(event("c"));
    expect(await restarted.get(event("a").eventId)).toBeNull();
  });

  it("does not ACK a duplicate until directory sync succeeds", async () => {
    const { store } = await inbox();
    const internal = store as unknown as { syncDirectory: () => Promise<void> };
    const sync = internal.syncDirectory.bind(store);
    let fail = true;
    internal.syncDirectory = async () => {
      if (fail) { fail = false; throw new Error("fsync failed"); }
      await sync();
    };
    await expect(store.accept(event())).rejects.toThrow("fsync failed");
    await expect(store.accept(event())).resolves.toBe("duplicate");
  });

  it("bounds archived bodies while retaining 30-day deduplication markers", async () => {
    const { dir } = await inbox();
    const store = new MeituanCallbackInbox(dir, 10, 1);
    await store.accept(event("a"));
    await store.ack(event("a").eventId);
    await store.accept(event("b"));
    await store.ack(event("b").eventId);
    expect(await store.get(event("a").eventId)).toBeNull();
    expect(await store.get(event("b").eventId)).toMatchObject({ acknowledged: true });
    expect(await store.accept(event("a"))).toBe("duplicate");
    await expect(store.accept({ ...event("a"), fingerprint: "f".repeat(64) })).rejects.toThrow("conflict");
    expect(await store.list()).toHaveLength(0);
  });

  it("backpressures acknowledgments when tombstones are full and preserves live deduplication", async () => {
    const { dir } = await inbox();
    const store = new MeituanCallbackInbox(dir, 20, 1);
    for (let index = 0; index < 10; index++) {
      await store.accept(event(String(index)));
      await store.ack(event(String(index)).eventId);
    }
    await store.accept(event("10"));
    await expect(store.ack(event("10").eventId)).rejects.toThrow("deduplication capacity full");
    const markers = (await (await import("node:fs/promises")).readdir(dir)).filter((name) => name.endsWith(".ack"));
    expect(markers).toHaveLength(10);
    expect(await store.accept(event("0"))).toBe("duplicate");
    expect(await store.list()).toMatchObject([{ msgId: "10" }]);
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000);
    await utimes(join(dir, `${event("0").eventId}.json.ack`), old, old);
    expect(await store.ack(event("10").eventId)).toBe(true);
    expect(await store.accept(event("0"))).toBe("created");
  });

  it("does not expose an ACK marker when its temporary file cannot be synchronized", async () => {
    const { store } = await inbox();
    await store.accept(event());
    const internal = store as unknown as { syncAckTemp: () => Promise<void> };
    const original = internal.syncAckTemp.bind(store);
    internal.syncAckTemp = async () => { throw new Error("ack fsync failed"); };
    await expect(store.ack(event().eventId)).rejects.toThrow("ack fsync failed");
    expect(await store.list()).toHaveLength(1);
    internal.syncAckTemp = original;
    expect(await store.ack(event().eventId)).toBe(true);
    expect(await store.list()).toHaveLength(0);
  });

  it("removes an incomplete event temp file after a failed file sync", async () => {
    const { dir, store } = await inbox();
    const internal = store as unknown as { syncEventTemp: () => Promise<void> };
    internal.syncEventTemp = async () => { throw new Error("event fsync failed"); };
    await expect(store.accept(event())).rejects.toThrow("event fsync failed");
    expect(await readdir(dir)).toEqual([]);
    expect(await store.list()).toHaveLength(0);
  });

  it("keeps an ACK pending until its directory sync succeeds", async () => {
    const { dir, store } = await inbox();
    await store.accept(event());
    const internal = store as unknown as { syncDirectory: () => Promise<void> };
    const sync = internal.syncDirectory.bind(store);
    internal.syncDirectory = async () => { throw new Error("ack directory fsync failed"); };
    await expect(store.ack(event().eventId)).rejects.toThrow("ack directory fsync failed");
    expect(await store.list()).toMatchObject([{ msgId: "a", acknowledged: false }]);
    expect(await new MeituanCallbackInbox(dir, 10).list()).toMatchObject([{ msgId: "a", acknowledged: false }]);
    internal.syncDirectory = sync;
    expect(await store.ack(event().eventId)).toBe(true);
    expect(await store.list()).toHaveLength(0);
  });

  it("does not confirm a new event when archived body compaction fails", async () => {
    const { dir } = await inbox();
    const store = new MeituanCallbackInbox(dir, 10, 1);
    await store.accept(event("a"));
    await store.ack(event("a").eventId);
    await store.accept(event("b"));
    const internal = store as unknown as { compactArchived: () => Promise<void> };
    const compact = internal.compactArchived.bind(store);
    internal.compactArchived = async () => { throw new Error("archive compaction failed"); };
    await expect(store.ack(event("b").eventId)).rejects.toThrow("archive compaction failed");
    expect(await store.list()).toMatchObject([{ msgId: "b", acknowledged: false }]);
    internal.compactArchived = compact;
    expect(await store.ack(event("b").eventId)).toBe(true);
    expect((await readdir(dir)).filter((name) => name.endsWith(".json"))).toHaveLength(1);
  });
});
