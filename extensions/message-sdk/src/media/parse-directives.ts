/**
 * 出站文本中的 MEDIA: 指令解析与剥离。
 */

import os from "node:os";

const MEDIA_DIRECTIVE_RE = /^MEDIA:\s*`?([^\n`]+?)`?\s*$/gm;

/**
 * 展开 ~ 为用户主目录路径。
 */
export function expandHomePath(filePath: string, homedir = os.homedir() || "/root"): string {
  const trimmed = filePath.trim();
  if (trimmed.startsWith("~/") || trimmed === "~") {
    return trimmed.replace(/^~/, homedir);
  }
  return trimmed;
}

/**
 * ParseMediaDirectivesResult 是 media 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type ParseMediaDirectivesResult = {
  /** 剥离 MEDIA: 行后的文本 */
  text: string;
  /** 去重后的媒体路径列表 */
  paths: string[];
};

/**
 * 从出站文本提取 MEDIA: 行路径并剥离指令行。
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
