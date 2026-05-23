/**
 * 【可选运营模块 — ICS Utils】OpenClaw 配置文件读写工具
 *
 * 仅供 `src/ics/handlers/` 使用，不在 KF 回调 / 出站 / Control Tools 核心链路中引用。
 * 封装对 openclaw.json、AGENTS.md、MEMORY.md、JSONL 等文件的操作。
 *
 * 所有文件操作都在 OpenClaw Gateway 进程内执行，
 * 通过 ICS REST API（`icsEnabled=true`）暴露给外部运营后台。
 */

import { readFile, writeFile, readdir, stat, mkdir, unlink } from "node:fs/promises";
import { join, basename } from "node:path";

/**
 * 读取 OpenClaw 配置文件（openclaw.json）
 * 配置文件路径从 Gateway runtime 获取
 *
 * @param configPath - openclaw.json 的绝对路径
 * @returns 解析后的配置对象
 */
export async function readOpenClawConfig(
  configPath: string
): Promise<Record<string, unknown>> {
  const content = await readFile(configPath, "utf-8");
  return JSON.parse(content);
}

/**
 * 写入 OpenClaw 配置文件
 * 写入后 Gateway 会自动检测变更并热重载
 *
 * @param configPath - openclaw.json 的绝对路径
 * @param config - 要写入的配置对象
 */
export async function writeOpenClawConfig(
  configPath: string,
  config: Record<string, unknown>
): Promise<void> {
  const content = JSON.stringify(config, null, 2);
  await writeFile(configPath, content, "utf-8");
}

/**
 * 读取 Markdown 文件（AGENTS.md / MEMORY.md）
 *
 * @param filePath - 文件绝对路径
 * @returns 文件内容和最后修改时间
 */
export async function readMarkdownFile(
  filePath: string
): Promise<{ content: string; lastModified: string }> {
  const [content, fileStats] = await Promise.all([
    readFile(filePath, "utf-8"),
    stat(filePath),
  ]);
  return {
    content,
    lastModified: fileStats.mtime.toISOString(),
  };
}

/**
 * 写入 Markdown 文件
 *
 * @param filePath - 文件绝对路径
 * @param content - 要写入的内容
 */
export async function writeMarkdownFile(
  filePath: string,
  content: string
): Promise<void> {
  await writeFile(filePath, content, "utf-8");
}

/**
 * 列出目录中的文件
 * 用于知识库文档管理
 *
 * @param dirPath - 目录绝对路径
 * @returns 文件信息列表
 */
export async function listFiles(
  dirPath: string
): Promise<Array<{ id: string; path: string; size: number; lastModified: string }>> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = join(dirPath, entry.name);
        const fileStats = await stat(filePath);
        files.push({
          id: basename(entry.name, ".md"), // 去掉 .md 后缀作为 ID
          path: filePath,
          size: fileStats.size,
          lastModified: fileStats.mtime.toISOString(),
        });
      }
    }

    return files;
  } catch {
    // 目录不存在
    return [];
  }
}

/**
 * 创建文件（知识库文档上传）
 *
 * @param dirPath - 目标目录
 * @param fileName - 文件名
 * @param content - 文件内容
 */
export async function createFile(
  dirPath: string,
  fileName: string,
  content: string
): Promise<string> {
  await mkdir(dirPath, { recursive: true });
  const filePath = join(dirPath, fileName);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

/**
 * 删除文件
 *
 * @param filePath - 文件绝对路径
 */
export async function deleteFile(filePath: string): Promise<void> {
  await unlink(filePath);
}

/**
 * 读取 JSONL 文件（会话记录）
 * 每行一个 JSON 对象
 *
 * @param filePath - JSONL 文件路径
 * @returns 解析后的 JSON 对象数组
 */
export async function readJsonlFile(
  filePath: string
): Promise<Record<string, unknown>[]> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * 获取 Agent 工作区路径
 * 根据 Agent 配置解析实际路径
 *
 * @param workspace - 工作区配置（如 "~/.openclaw/workspace-presale"）
 * @returns 解析后的绝对路径
 */
export function resolveWorkspacePath(workspace: string): string {
  if (workspace.startsWith("~/")) {
    return join(process.env.HOME ?? "/root", workspace.slice(2));
  }
  return workspace;
}
