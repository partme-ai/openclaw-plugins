/**
 * @fileoverview 微信 iPad 入站消息的私有持久去重日志。
 *
 * 热路径使用内存 Map，成功处理后再向 JSONL 追加记录；Gateway 重启时恢复未过期的消息 ID。
 * 文件始终位于 OpenClaw 状态目录，目录权限为 0700、文件权限为 0600。压缩采用同目录临时
 * 文件加原子 rename，崩溃留下的半行会在下次加载时忽略，不会阻断消息接收。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10_000;

type ProcessedRecord = { id: string; seenAt: number };

/** 解析与 OpenClaw Core 一致的状态根目录，E2E 可通过环境变量实现完全隔离。 */
export function resolveWechatIpadProcessedMessagesPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.OPENCLAW_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".openclaw");
  return path.join(root, "wechat-ipad", "processed-messages.jsonl");
}

/**
 * 有界持久去重存储。
 *
 * 调用方只能在 Agent 调度与回复投递成功后 `mark`；失败消息不落盘，允许桥接服务再次投递。
 */
export class WechatIpadProcessedMessageStore {
  private readonly entries = new Map<string, number>();
  private appendCount = 0;

  constructor(
    private readonly filePath: string,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {
    this.load();
  }

  /** 判断消息是否仍在有效去重窗口内；过期记录在读取时顺便移除。 */
  has(messageId: string, now = Date.now()): boolean {
    const seenAt = this.entries.get(messageId);
    if (seenAt === undefined) return false;
    if (now - seenAt > this.ttlMs) {
      this.entries.delete(messageId);
      return false;
    }
    return true;
  }

  /** 记录一条已经完整处理成功的消息，并在达到阈值时原子压缩日志。 */
  mark(messageId: string, now = Date.now()): void {
    this.entries.set(messageId, now);
    this.ensurePrivateDirectory();
    fs.appendFileSync(
      this.filePath,
      `${JSON.stringify({ id: messageId, seenAt: now } satisfies ProcessedRecord)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    fs.chmodSync(this.filePath, 0o600);
    this.appendCount += 1;
    const shouldCompact = this.entries.size > this.maxEntries || this.appendCount > this.maxEntries * 2;
    this.prune(now);
    if (shouldCompact) this.compact();
  }

  /** 从上次运行恢复合法且未过期的记录；缺失文件或尾部半行按可恢复状态处理。 */
  private load(): void {
    try {
      const lines = fs.readFileSync(this.filePath, "utf8").split("\n");
      const now = Date.now();
      for (const line of lines) {
        if (!line) continue;
        try {
          const record = JSON.parse(line) as Partial<ProcessedRecord>;
          if (typeof record.id === "string" && Number.isFinite(record.seenAt) &&
              now - (record.seenAt as number) <= this.ttlMs) {
            this.entries.set(record.id, record.seenAt as number);
          }
        } catch {
          // 进程崩溃可能留下最后一条半写入记录；忽略它，已完成记录仍然有效。
        }
      }
      this.appendCount = lines.length;
      this.prune(now);
      if (this.appendCount > this.maxEntries * 2) this.compact();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // 状态损坏或暂时不可读时选择继续接收消息，后续 mark 会暴露真实文件系统错误。
        this.entries.clear();
      }
    }
  }

  /** 同时按 TTL 和容量淘汰，避免恶意或异常消息 ID 让状态无限增长。 */
  private prune(now: number): void {
    for (const [id, seenAt] of this.entries) {
      if (now - seenAt > this.ttlMs) this.entries.delete(id);
    }
    if (this.entries.size <= this.maxEntries) return;
    const oldest = [...this.entries.entries()].sort((left, right) => left[1] - right[1]);
    for (let index = 0; index < oldest.length - this.maxEntries; index += 1) {
      this.entries.delete(oldest[index][0]);
    }
  }

  /** 以同目录临时文件替换旧日志，rename 保证读者只会看到旧版或完整新版。 */
  private compact(): void {
    this.ensurePrivateDirectory();
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = [...this.entries]
      .map(([id, seenAt]) => JSON.stringify({ id, seenAt } satisfies ProcessedRecord))
      .join("\n");
    try {
      fs.writeFileSync(tempPath, payload ? `${payload}\n` : "", { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);
      fs.chmodSync(this.filePath, 0o600);
      this.appendCount = this.entries.size;
    } finally {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // 文件已被 rename，或写入尚未创建临时文件。
      }
    }
  }

  /** 创建并收紧插件私有目录权限；已有目录也重新 chmod，避免继承宽松 umask。 */
  private ensurePrivateDirectory(): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }
}
