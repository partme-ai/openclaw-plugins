/** 美团回调持久收件箱：安全落盘、确认与过期清理通知事件。 */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { MeituanNotification } from "./parser.js";

type StoredNotification = MeituanNotification & { acknowledged: boolean };
type AckMarker = { fingerprint: string; acknowledgedAt: number };
const ACK_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

/** 本地持久收件箱：写入与目录同步完成之后，HTTP 层才可发送成功回执。 */
export class MeituanCallbackInbox {
  private mutating: Promise<void> = Promise.resolve();
  private lastPrunedAt = 0;
  private readonly uncommittedAcks = new Set<string>();
  constructor(private readonly directory: string, private readonly maxEntries: number, private readonly maxArchivedEntries = 2_000) {}

  private async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(this.directory)).isDirectory()) throw new Error("callback inbox path is not a directory");
    await chmod(this.directory, 0o700);
  }

  private file(eventId: string): string {
    if (!/^[a-f0-9]{64}$/u.test(eventId)) throw new Error("invalid callback event id");
    return join(this.directory, `${eventId}.json`);
  }

  private async syncDirectory(): Promise<void> {
    const handle = await open(this.directory, constants.O_RDONLY);
    try { await handle.sync(); } finally { await handle.close(); }
  }

  private async syncAckTemp(handle: FileHandle): Promise<void> {
    await handle.sync();
  }

  private async syncEventTemp(handle: FileHandle): Promise<void> {
    await handle.sync();
  }

  async accept(event: MeituanNotification): Promise<"created" | "duplicate"> {
    return this.enqueue(() => this.acceptOne(event));
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutating;
    let release!: () => void;
    this.mutating = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); }
    finally { release(); }
  }

  private async acceptOne(event: MeituanNotification): Promise<"created" | "duplicate"> {
    await this.prepare();
    await this.pruneAcknowledged();
    const path = this.file(event.eventId);
    const prior = await this.get(event.eventId);
    if (prior) {
      if (prior.fingerprint !== event.fingerprint) throw new Error("callback event conflict");
      await this.syncDirectory();
      return "duplicate";
    }
    const marker = await this.readAckMarker(path);
    if (marker) {
      if (marker.fingerprint !== event.fingerprint) throw new Error("callback event conflict");
      await this.syncDirectory();
      return "duplicate";
    }
    const names = await readdir(this.directory);
    const acknowledged = new Set(names.filter((name) => /^[a-f0-9]{64}\.json\.ack$/u.test(name) && !this.uncommittedAcks.has(name.slice(0, 64))));
    const count = names.filter((name) => /^[a-f0-9]{64}\.json$/u.test(name) && !acknowledged.has(`${name}.ack`)).length;
    if (count >= this.maxEntries) throw new Error("callback inbox full");
    const temp = join(this.directory, `${event.eventId}.${process.pid}.${randomUUID()}.tmp`);
    const handle = await open(temp, "wx", 0o600);
    try {
      try {
        await handle.writeFile(JSON.stringify(event), "utf8");
        await this.syncEventTemp(handle);
      } finally { await handle.close(); }
      try {
        await link(temp, path);
        await this.syncDirectory();
        return "created";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          const raced = await this.get(event.eventId);
          if (raced?.fingerprint === event.fingerprint) {
            await this.syncDirectory();
            return "duplicate";
          }
          throw new Error("callback event conflict");
        }
        throw error;
      }
    } finally { await unlink(temp); }
  }

  private async readAckMarker(path: string): Promise<AckMarker | null> {
    let raw: string;
    try { raw = await readFile(`${path}.ack`, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const marker = JSON.parse(raw) as Partial<AckMarker>;
    if (!/^[a-f0-9]{64}$/u.test(marker.fingerprint ?? "") || !Number.isSafeInteger(marker.acknowledgedAt)) {
      throw new Error("invalid callback acknowledgment marker");
    }
    return marker as AckMarker;
  }

  /** 保留小型去重标记，并在归档超限时删除最早确认的完整正文。 */
  private async compactArchived(maxBodies = this.maxArchivedEntries): Promise<void> {
    const names = await readdir(this.directory);
    const files = new Set(names.filter((name) => /^[a-f0-9]{64}\.json$/u.test(name)));
    const archived = names.filter((name) => /^[a-f0-9]{64}\.json\.ack$/u.test(name) && files.has(name.slice(0, -4)));
    if (archived.length <= maxBodies) return;
    const ordered: Array<{ name: string; time: number }> = [];
    for (const name of archived) ordered.push({ name, time: (await lstat(join(this.directory, name))).mtimeMs });
    ordered.sort((a, b) => a.time - b.time);
    for (const item of ordered.slice(0, archived.length - maxBodies)) {
      await unlink(join(this.directory, item.name.slice(0, -4)));
    }
    await this.syncDirectory();
  }

  private async pruneAcknowledged(force = false): Promise<void> {
    if (!force && Date.now() - this.lastPrunedAt < 3_600_000) return;
    const names = (await readdir(this.directory)).filter((name) => /^[a-f0-9]{64}\.json\.ack$/u.test(name));
    for (const name of names) {
      const marker = join(this.directory, name);
      if (Date.now() - (await lstat(marker)).mtimeMs < ACK_RETENTION_MS) continue;
      await unlink(join(this.directory, name.slice(0, -4))).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await unlink(marker);
    }
    if (names.length > 0) await this.syncDirectory();
    this.lastPrunedAt = Date.now();
  }

  async get(eventId: string): Promise<StoredNotification | null> {
    const path = this.file(eventId);
    let raw: string;
    try { raw = await readFile(path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const event = JSON.parse(raw) as MeituanNotification;
    const acknowledged = await lstat(`${path}.ack`).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
    return { ...event, acknowledged: acknowledged && !this.uncommittedAcks.has(eventId) };
  }

  async list(limit = 20): Promise<StoredNotification[]> {
    await this.prepare();
    const names = await readdir(this.directory);
    const acknowledged = new Set(names.filter((name) => /^[a-f0-9]{64}\.json\.ack$/u.test(name) && !this.uncommittedAcks.has(name.slice(0, 64))));
    const pending = names.filter((name) => /^[a-f0-9]{64}\.json$/u.test(name) && !acknowledged.has(`${name}.ack`));
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const latest: Array<{ name: string; modifiedAt: number }> = [];
    for (const name of pending) {
      const modifiedAt = (await lstat(join(this.directory, name))).mtimeMs;
      latest.push({ name, modifiedAt });
      latest.sort((a, b) => b.modifiedAt - a.modifiedAt);
      if (latest.length > boundedLimit) latest.pop();
    }
    const events: StoredNotification[] = [];
    for (const item of latest) {
      const event = await this.get(item.name.slice(0, 64));
      if (event && !event.acknowledged) events.push(event);
    }
    return events;
  }

  async ack(eventId: string, assertCurrent?: () => void): Promise<boolean> {
    return this.enqueue(() => this.ackOne(eventId, assertCurrent));
  }

  private async ackOne(eventId: string, assertCurrent?: () => void): Promise<boolean> {
    const path = this.file(eventId);
    const event = await this.get(eventId);
    if (!event) return false;
    assertCurrent?.();
    const existing = await this.readAckMarker(path);
    if (existing) {
      if (existing.fingerprint !== event.fingerprint) throw new Error("callback event conflict");
      await this.syncDirectory();
      this.uncommittedAcks.delete(eventId);
      return true;
    }
    const markerLimit = this.maxArchivedEntries * 10;
    if ((await readdir(this.directory)).filter((name) => /^[a-f0-9]{64}\.json\.ack$/u.test(name)).length >= markerLimit) {
      await this.pruneAcknowledged(true);
      if ((await readdir(this.directory)).filter((name) => /^[a-f0-9]{64}\.json\.ack$/u.test(name)).length >= markerLimit) {
        throw new Error("callback deduplication capacity full");
      }
    }
    // 为新确认预留一个归档正文槽位；压缩失败时保持事件待办。
    await this.compactArchived(this.maxArchivedEntries - 1);
    const temp = join(this.directory, `${eventId}.${process.pid}.${randomUUID()}.acktmp`);
    const handle = await open(temp, "wx", 0o600);
    try {
      try {
        await handle.writeFile(JSON.stringify({ fingerprint: event.fingerprint, acknowledgedAt: Date.now() } satisfies AckMarker));
        await this.syncAckTemp(handle);
      } finally { await handle.close(); }
      assertCurrent?.();
      let createdMarker = false;
      try { await link(temp, `${path}.ack`); createdMarker = true; this.uncommittedAcks.add(eventId); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const raced = await this.readAckMarker(path);
        if (raced?.fingerprint !== event.fingerprint) throw new Error("callback event conflict");
        this.uncommittedAcks.add(eventId);
      }
      try { await this.syncDirectory(); }
      catch (error) {
        if (createdMarker) {
          await unlink(`${path}.ack`);
          await this.syncDirectory();
        }
        throw error;
      }
      this.uncommittedAcks.delete(eventId);
    } finally {
      await unlink(temp);
    }
    return true;
  }
}
