import fs from "node:fs";
import path from "node:path";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10_000;

type ProcessedMessageRecord = { id: string; seenAt: number };

export class ProcessedMessageStore {
  private readonly entries = new Map<string, number>();
  private appendCount = 0;

  constructor(
    private readonly filePath: string,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {
    this.load();
  }

  has(messageId: string, now = Date.now()): boolean {
    const seenAt = this.entries.get(messageId);
    if (seenAt === undefined) return false;
    if (now - seenAt > this.ttlMs) {
      this.entries.delete(messageId);
      return false;
    }
    return true;
  }

  mark(messageId: string, now = Date.now()): void {
    this.entries.set(messageId, now);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(
      this.filePath,
      `${JSON.stringify({ id: messageId, seenAt: now } satisfies ProcessedMessageRecord)}\n`,
      { encoding: "utf-8", mode: 0o600 },
    );
    fs.chmodSync(this.filePath, 0o600);
    this.appendCount += 1;
    const needsCompaction = this.entries.size > this.maxEntries || this.appendCount > this.maxEntries * 2;
    this.prune(now);
    if (needsCompaction) this.compact();
  }

  private load(): void {
    try {
      const lines = fs.readFileSync(this.filePath, "utf-8").split("\n");
      const now = Date.now();
      for (const line of lines) {
        if (!line) continue;
        try {
          const record = JSON.parse(line) as ProcessedMessageRecord;
          if (typeof record.id === "string" && Number.isFinite(record.seenAt) && now - record.seenAt <= this.ttlMs) {
            this.entries.set(record.id, record.seenAt);
          }
        } catch { /* ignore a partial/corrupt record */ }
      }
      this.appendCount = lines.length;
      this.prune(now);
      if (this.appendCount > this.maxEntries * 2) this.compact();
    } catch {
      // Missing/corrupt state fails open for delivery; the cursor still prevents old replay.
    }
  }

  private prune(now: number): void {
    for (const [key, seenAt] of this.entries) {
      if (now - seenAt > this.ttlMs) this.entries.delete(key);
    }
    if (this.entries.size <= this.maxEntries) return;
    const oldest = [...this.entries.entries()].sort((a, b) => a[1] - b[1]);
    for (let index = 0; index < oldest.length - this.maxEntries; index += 1) {
      this.entries.delete(oldest[index][0]);
    }
  }

  private compact(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = [...this.entries]
      .map(([id, seenAt]) => JSON.stringify({ id, seenAt } satisfies ProcessedMessageRecord))
      .join("\n");
    try {
      fs.writeFileSync(tempPath, payload ? `${payload}\n` : "", { encoding: "utf-8", mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);
      fs.chmodSync(this.filePath, 0o600);
      this.appendCount = this.entries.size;
    } finally {
      try { fs.unlinkSync(tempPath); } catch { /* already renamed or never created */ }
    }
  }
}
