/** 已记录或记录状态不明的 KF 入站消息隔离索引；人工核对前禁止整轮重跑。 */
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveOpenClawStateDir } from "@partme.ai/openclaw-message-sdk";
import type { TranscriptRecordState } from "@partme.ai/openclaw-message-sdk";

export type KfInboundRecoveryEntry = {
  msgId: string;
  phase: "processing" | "quarantined";
  recordState?: Exclude<TranscriptRecordState, "not_started">;
  reason: string;
  createdAt: number;
};

type RecoveryState = { version: 1; entries: Record<string, KfInboundRecoveryEntry> };
const MAX_ENTRIES = 10_000;
const MAX_BYTES = 1024 * 1024;
const writes = new Map<string, Promise<void>>();
/** 隔离写盘失败时继续在本进程阻断重跑；重启由已落盘的 processing 标记接管。 */
const volatileQuarantines = new Map<string, KfInboundRecoveryEntry>();

function entryKey(file: string, msgId: string): string {
  return `${file}\0${msgId}`;
}

export function resolveKfInboundRecoveryPath(openKfId: string, stateDir = resolveOpenClawStateDir()): string {
  const hash = createHash("sha256").update(openKfId).digest("hex").slice(0, 20);
  return join(stateDir, "wecom-kf", "inbound-recovery", `${hash}.json`);
}

async function readState(file: string): Promise<RecoveryState> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, entries: {} };
    }
    throw error;
  }
  if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error("KF inbound recovery state exceeds size limit");
  const state = JSON.parse(raw) as Partial<RecoveryState>;
  if (state.version !== 1 || !state.entries || typeof state.entries !== "object") {
    throw new Error("invalid KF inbound recovery state");
  }
  return state as RecoveryState;
}

export async function getKfInboundRecovery(params: {
  openKfId: string;
  msgId: string;
  stateDir?: string;
}): Promise<KfInboundRecoveryEntry | null> {
  const file = resolveKfInboundRecoveryPath(params.openKfId, params.stateDir);
  const volatile = volatileQuarantines.get(entryKey(file, params.msgId));
  if (volatile) return volatile;
  await writes.get(file);
  return (await readState(file)).entries[params.msgId] ?? null;
}

async function updateState(file: string, change: (state: RecoveryState) => void): Promise<void> {
  const save = async () => {
    const state = await readState(file);
    change(state);
    const payload = `${JSON.stringify(state)}\n`;
    if (Buffer.byteLength(payload) > MAX_BYTES) throw new Error("KF inbound recovery state exceeds size limit");
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await chmod(dirname(file), 0o700);
    const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(payload);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file);
      const dir = await open(dirname(file), "r");
      try { await dir.sync(); } finally { await dir.close(); }
    } finally {
      await rm(temporary, { force: true });
    }
  };
  const previous = writes.get(file) ?? Promise.resolve();
  const write = previous.then(save, save);
  writes.set(file, write);
  try {
    await write;
  } finally {
    if (writes.get(file) === write) writes.delete(file);
  }
}

/** 在调用宿主之前持久预留本轮；残留标记在重启后要求人工核对。 */
export async function beginKfInboundProcessing(params: {
  openKfId: string; msgId: string; stateDir?: string;
}): Promise<void> {
  const file = resolveKfInboundRecoveryPath(params.openKfId, params.stateDir);
  await updateState(file, (state) => {
    if (state.entries[params.msgId]) throw new Error("KF inbound already needs recovery review");
    if (Object.keys(state.entries).length >= MAX_ENTRIES) throw new Error("KF inbound recovery state is full");
    state.entries[params.msgId] = {
      msgId: params.msgId, phase: "processing", reason: "host turn may have started", createdAt: Date.now(),
    };
  });
}

/** 成功提交去重或确认记录前失败后，才允许移除 processing 标记。 */
export async function finishKfInboundProcessing(params: {
  openKfId: string; msgId: string; stateDir?: string;
}): Promise<void> {
  const file = resolveKfInboundRecoveryPath(params.openKfId, params.stateDir);
  await updateState(file, (state) => { delete state.entries[params.msgId]; });
  volatileQuarantines.delete(entryKey(file, params.msgId));
}

export async function putKfInboundRecovery(params: {
  openKfId: string;
  msgId: string;
  recordState: Exclude<TranscriptRecordState, "not_started">;
  reason: string;
  stateDir?: string;
}): Promise<void> {
  const file = resolveKfInboundRecoveryPath(params.openKfId, params.stateDir);
  const key = entryKey(file, params.msgId);
  const entry: KfInboundRecoveryEntry = {
    msgId: params.msgId,
    phase: "quarantined",
    recordState: params.recordState,
    reason: params.reason.replace(/[\r\n\t\u0000-\u001f\u007f]+/gu, " ").slice(0, 300),
    createdAt: Date.now(),
  };
  volatileQuarantines.set(key, entry);
  await updateState(file, (state) => {
    if (!state.entries[params.msgId] && Object.keys(state.entries).length >= MAX_ENTRIES) {
      throw new Error("KF inbound recovery state is full");
    }
    state.entries[params.msgId] = entry;
  });
  volatileQuarantines.delete(key);
}
