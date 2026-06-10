/**
 * @module media/parse-directives
 *
 * 出站文本中的 `MEDIA:` 指令解析与剥离。
 *
 * **职责**：Agent 回复中显式输出的 `MEDIA:` 行会被提取为媒体路径列表，
 * 并从正文中移除，避免 IM 平台展示原始指令。
 *
 * **关键导出**：`parseMediaDirectives`、`expandHomePath`
 */

import os from "node:os";

/** 匹配整行 `MEDIA: \`path\`` 或 `MEDIA: path` 指令 */
const MEDIA_DIRECTIVE_RE = /^MEDIA:\s*`?([^\n`]+?)`?\s*$/gm;

/**
 * 展开 `~` 为用户主目录路径。
 *
 * @param filePath - 可能含 `~/` 前缀的路径
 * @param homedir - 主目录（默认 `os.homedir()`）
 * @returns 展开后的路径；非 `~` 开头则原样 trim 返回
 *
 * @example
 * ```ts
 * expandHomePath("~/Downloads/a.png"); // => "/Users/me/Downloads/a.png"
 * ```
 */
export function expandHomePath(filePath: string, homedir = os.homedir() || "/root"): string {
  const trimmed = filePath.trim();
  if (trimmed.startsWith("~/") || trimmed === "~") {
    return trimmed.replace(/^~/, homedir);
  }
  return trimmed;
}

/**
 * `parseMediaDirectives` 返回值 / Result of parsing MEDIA directives.
 *
 * @property text - 剥离 `MEDIA:` 行后的正文
 * @property paths - 去重后的媒体路径列表（已展开 `~`）
 */
export type ParseMediaDirectivesResult = {
  /** 剥离 MEDIA: 行后的文本 */
  text: string;
  /** 去重后的媒体路径列表 */
  paths: string[];
};

/**
 * 从出站文本提取 `MEDIA:` 行路径并剥离指令行。
 *
 * 处理逻辑：
 * 1. 逐行匹配 `MEDIA:` 前缀
 * 2. 展开 `~` 并去重
 * 3. 从正文删除所有 `MEDIA:` 行，压缩多余空行
 *
 * @param text - Agent 出站原文
 * @param options.homedir - 主目录（用于 `~` 展开）
 * @returns 剥离后的文本与路径列表
 *
 * @example
 * ```ts
 * parseMediaDirectives("你好\nMEDIA: ~/a.png\n再见");
 * // => { text: "你好\n\n再见", paths: ["/Users/me/a.png"] }
 * ```
 */
export function parseMediaDirectives(
  text: string,
  options?: { homedir?: string },
): ParseMediaDirectivesResult {
  const homedir = options?.homedir ?? (os.homedir() || "/root");
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(MEDIA_DIRECTIVE_RE.source, MEDIA_DIRECTIVE_RE.flags);
  while ((match = re.exec(text)) !== null) {
    const expanded = expandHomePath(match[1] ?? "", homedir);
    if (expanded && !paths.includes(expanded)) {
      paths.push(expanded);
    }
  }
  const stripped = text
    .replace(/^MEDIA:\s*`?[^\n`]+?`?\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: stripped, paths };
}
