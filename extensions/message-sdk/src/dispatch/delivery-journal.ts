/**
 * 入站投递持久结算日志：保存 Agent 启动、回复发送和最终处置，重启后拦截不确定投递的重复执行。
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "../openclaw/state-dir.js";

// tsup's Node16 target rewrites the new built-in specifier to "sqlite";
// a runtime require keeps Node 24's built-in module identity intact.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export type JournalClaim = "claimed" | "pending" | "delivered" | "no-reply" | "ack-pending-delivered" | "ack-pending-no-reply";
/** The broker reused an identity for different inbound content or routing. */
export class DeliveryIdentityConflictError extends Error {
  constructor(public readonly channel: string, public readonly accountId: string, public readonly inboundId: string) {
    super(`Delivery identity conflict: ${channel}/${accountId}/${inboundId}`);
    this.name = "DeliveryIdentityConflictError";
  }
}
/** A prior turn may already have sent a visible reply; operator reconciliation is required. */
export class PendingDeliveryReconciliationError extends Error {
  constructor(public readonly channel: string, public readonly accountId: string, public readonly inboundId: string, cause?: unknown) {
    super(`Pending delivery reconciliation required: ${channel}/${accountId}/${inboundId}`, { cause });
    this.name = "PendingDeliveryReconciliationError";
  }
}
export type JournalEntry = {
  status: "processing" | "pending" | "delivered" | "no-reply" | "ack-pending-delivered" | "ack-pending-no-reply";
  sendsStarted: number;
  sendsConfirmed: number;
  lastWireHash: string | null;
  inboundFingerprint: string | null;
  agentStarted: number;
  ownerPid: number | null;
  ownerStart: string | null;
};

export interface DeliveryJournal {
  claim(channel: string, accountId: string, inboundId: string, inboundFingerprint: string): JournalClaim;
  markAgentStarted(channel: string, accountId: string, inboundId: string): void;
  sendStarted(channel: string, accountId: string, inboundId: string, wireHash: string): void;
  sendConfirmed(channel: string, accountId: string, inboundId: string, wireHash: string): void;
  settle(channel: string, accountId: string, inboundId: string, outcome: "delivered" | "no-reply"): void;
  prepareSettlement(channel: string, accountId: string, inboundId: string, outcome: "delivered" | "no-reply"): void;
  confirmPreparedSettlement(channel: string, accountId: string, inboundId: string, outcome: "delivered" | "no-reply"): void;
  listPreparedSettlements(): Array<{ channel: string; accountId: string; inboundId: string; status: "ack-pending-delivered" | "ack-pending-no-reply"; updatedAt: number }>;
  releaseBeforeSend(channel: string, accountId: string, inboundId: string): void;
  inspect(channel: string, accountId: string, inboundId: string): JournalEntry | undefined;
  close(): void;
}

/** Open the profile-local journal. A symlink at the private directory is rejected. */
export function createDeliveryJournal(stateDir = resolveOpenClawStateDir()): DeliveryJournal {
  const pluginDir = join(stateDir, "plugins");
  const privateDir = join(pluginDir, "message-sdk");
  mkdirSync(pluginDir, { recursive: true, mode: 0o700 });
  if (!lstatSync(pluginDir).isDirectory()) throw new Error("Delivery journal plugin directory is not a directory");
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  if (!lstatSync(privateDir).isDirectory()) throw new Error("Delivery journal directory is not a directory");
  chmodSync(privateDir, 0o700);
  const dbPath = join(privateDir, "delivery-journal.sqlite");
  const existing = lstatSync(dbPath, { throwIfNoEntry: false });
  if (existing && !existing.isFile()) throw new Error("Delivery journal database is not a regular file");
  const db = new DatabaseSync(dbPath);
  let read: ReturnType<typeof db.prepare>;
  try {
    chmodSync(dbPath, 0o600);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    db.exec(`CREATE TABLE IF NOT EXISTS delivery (
    channel TEXT NOT NULL, account_id TEXT NOT NULL, inbound_id TEXT NOT NULL,
    status TEXT NOT NULL, sends_started INTEGER NOT NULL DEFAULT 0,
    sends_confirmed INTEGER NOT NULL DEFAULT 0, last_wire_hash TEXT,
    inbound_fingerprint TEXT, agent_started INTEGER NOT NULL DEFAULT 0, owner_pid INTEGER, owner_start TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(channel, account_id, inbound_id)
    )`);
    // Older in-development journals remain readable, but an unbound identity cannot be replayed silently.
    const columns = new Set((db.prepare("PRAGMA table_info(delivery)").all() as Array<{ name: string }>).map(({ name }) => name));
    if (!columns.has("inbound_fingerprint")) db.exec("ALTER TABLE delivery ADD COLUMN inbound_fingerprint TEXT");
    if (!columns.has("agent_started")) db.exec("ALTER TABLE delivery ADD COLUMN agent_started INTEGER NOT NULL DEFAULT 0");
    if (!columns.has("owner_pid")) db.exec("ALTER TABLE delivery ADD COLUMN owner_pid INTEGER");
    if (!columns.has("owner_start")) db.exec("ALTER TABLE delivery ADD COLUMN owner_start TEXT");
    read = db.prepare("SELECT status, sends_started AS sendsStarted, sends_confirmed AS sendsConfirmed, last_wire_hash AS lastWireHash, inbound_fingerprint AS inboundFingerprint, agent_started AS agentStarted, owner_pid AS ownerPid, owner_start AS ownerStart FROM delivery WHERE channel=? AND account_id=? AND inbound_id=?");
  } catch (error) {
    db.close();
    throw error;
  }
  const key = (channel: string, accountId: string, inboundId: string) => {
    if (!channel.trim() || !accountId.trim() || !inboundId.trim()) throw new Error("Stable delivery identity is required");
    return [channel, accountId, inboundId] as const;
  };
  const inspect = (channel: string, accountId: string, inboundId: string) =>
    read.get(...key(channel, accountId, inboundId)) as JournalEntry | undefined;
  const processStart = (pid: number): string | null => {
    try { return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8", timeout: 2000 }).trim() || null; }
    catch { return null; }
  };
  const ownStart = processStart(process.pid);
  const ownerAlive = (pid: number | null, start: string | null) => {
    if (pid === null || pid <= 0) return true;
    try { process.kill(pid, 0); }
    catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
    if (start === null) return true;
    const observed = processStart(pid);
    return observed === null || observed === start;
  };
  return {
    claim(channel, accountId, inboundId, inboundFingerprint) {
      const parts = key(channel, accountId, inboundId);
      if (!inboundFingerprint.trim()) throw new Error("Inbound payload and route fingerprint is required");
      db.exec("BEGIN IMMEDIATE");
      try {
        const inserted = db.prepare("INSERT OR IGNORE INTO delivery(channel,account_id,inbound_id,status,inbound_fingerprint,owner_pid,owner_start,updated_at) VALUES(?,?,?,'processing',?,?,?,?)")
          .run(...parts, inboundFingerprint, process.pid, ownStart, Date.now()).changes > 0;
        const entry = inspect(...parts);
        if (entry && entry.inboundFingerprint !== inboundFingerprint) {
          throw new DeliveryIdentityConflictError(channel, accountId, inboundId);
        }
        let recovered = false;
        if (!inserted && entry?.status === "processing" && entry.agentStarted === 0 && entry.sendsStarted === 0 && !ownerAlive(entry.ownerPid, entry.ownerStart)) {
          recovered = db.prepare("UPDATE delivery SET owner_pid=?, owner_start=?, updated_at=? WHERE channel=? AND account_id=? AND inbound_id=? AND status='processing' AND agent_started=0 AND sends_started=0")
            .run(process.pid, ownStart, Date.now(), ...parts).changes === 1;
        }
        db.exec("COMMIT");
        return inserted || recovered ? "claimed" : entry?.status === "delivered" || entry?.status === "no-reply" || entry?.status === "ack-pending-delivered" || entry?.status === "ack-pending-no-reply" ? entry.status : "pending";
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    markAgentStarted(channel, accountId, inboundId) {
      const result = db.prepare("UPDATE delivery SET agent_started=1, updated_at=? WHERE channel=? AND account_id=? AND inbound_id=? AND status='processing' AND agent_started=0 AND owner_pid=?")
        .run(Date.now(), ...key(channel, accountId, inboundId), process.pid);
      if (result.changes !== 1) throw new Error("Delivery journal Agent start requires an active claim");
    },
    sendStarted(channel, accountId, inboundId, wireHash) {
      const result = db.prepare("UPDATE delivery SET status='pending', sends_started=sends_started+1, last_wire_hash=?, updated_at=? WHERE channel=? AND account_id=? AND inbound_id=? AND status IN ('processing','pending')")
        .run(wireHash, Date.now(), ...key(channel, accountId, inboundId));
      if (result.changes !== 1) throw new Error("Delivery journal send_started requires an active claim");
    },
    sendConfirmed(channel, accountId, inboundId, wireHash) {
      const result = db.prepare("UPDATE delivery SET sends_confirmed=sends_confirmed+1, updated_at=? WHERE channel=? AND account_id=? AND inbound_id=? AND status='pending' AND last_wire_hash=?")
        .run(Date.now(), ...key(channel, accountId, inboundId), wireHash);
      if (result.changes !== 1) throw new Error("Delivery journal send_confirmed has no matching send_started");
    },
    settle(channel, accountId, inboundId, outcome) {
      const result = db.prepare("UPDATE delivery SET status=?, updated_at=? WHERE channel=? AND account_id=? AND inbound_id=? AND status IN ('processing','pending')")
        .run(outcome, Date.now(), ...key(channel, accountId, inboundId));
      if (result.changes !== 1) throw new Error("Delivery journal settlement requires an active claim");
    },
    prepareSettlement(channel, accountId, inboundId, outcome) {
      const result = db.prepare("UPDATE delivery SET status=?, updated_at=? WHERE channel=? AND account_id=? AND inbound_id=? AND status IN ('processing','pending') AND sends_started=sends_confirmed AND (?='no-reply' OR sends_confirmed>0)")
        .run(`ack-pending-${outcome}`, Date.now(), ...key(channel, accountId, inboundId), outcome);
      if (result.changes !== 1) throw new Error("Delivery journal preparation requires a confirmed outcome");
    },
    confirmPreparedSettlement(channel, accountId, inboundId, outcome) {
      const result = db.prepare("UPDATE delivery SET status=?, updated_at=? WHERE channel=? AND account_id=? AND inbound_id=? AND status=?")
        .run(outcome, Date.now(), ...key(channel, accountId, inboundId), `ack-pending-${outcome}`);
      if (result.changes !== 1) throw new Error("Delivery journal confirmation requires a prepared outcome");
    },
    listPreparedSettlements() {
      return db.prepare("SELECT channel, account_id AS accountId, inbound_id AS inboundId, status, updated_at AS updatedAt FROM delivery WHERE status IN ('ack-pending-delivered','ack-pending-no-reply') ORDER BY updated_at")
        .all() as ReturnType<DeliveryJournal["listPreparedSettlements"]>;
    },
    releaseBeforeSend(channel, accountId, inboundId) {
      db.prepare("DELETE FROM delivery WHERE channel=? AND account_id=? AND inbound_id=? AND status='processing' AND agent_started=0 AND sends_started=0 AND owner_pid=?")
        .run(...key(channel, accountId, inboundId), process.pid);
    },
    inspect,
    close() { db.close(); },
  };
}
