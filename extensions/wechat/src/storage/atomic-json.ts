/**
 * @fileoverview 微信插件敏感 JSON 状态的原子写入工具。
 *
 * Token、context_token 与 get_updates_buf 不能直接覆盖目标文件：进程在 truncate 与写完之间
 * 崩溃会留下空文件，可能导致凭据丢失、无法回复或从错误游标重放。这里先以 0600 写入同目录
 * 临时文件，再原子 rename；父目录固定为 0700，避免同机其他用户读取会话状态。
 */
import fs from "node:fs";
import path from "node:path";

export function writePrivateJsonAtomic(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // 某些文件系统不支持 chmod；写入本身仍应继续，由部署侧目录 ACL 提供兜底。
  }
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // 同上：不让不支持 POSIX mode 的平台把一次完整写入误判为失败。
    }
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // rename 成功后临时文件已不存在；异常前未创建也无需处理。
    }
  }
}
