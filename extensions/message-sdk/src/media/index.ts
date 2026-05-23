/**
 * @module media
 *
 * 媒体模块 — 媒体解析 + IO / Media parsing and I/O utilities.
 *
 * **职责 / Responsibilities**：
 * - 从 Agent 出站文本解析 `MEDIA:` 指令、Markdown/HTML 图片与文件引用
 * - 远程 URL / 本机路径 → Buffer 加载（出站）
 * - 入站媒体下载、归档、清理与路径沙箱
 *
 * **来源**：openclaw-china packages/shared/src/media/ (MIT License)
 *
 * **关键导出 / Key exports**：
 * - `parseMediaDirectives`、`extractMediaFromText`、`resolveOutboundMedia`
 * - `fetchMediaFromUrl`、`readMedia`、`getPathGuard`
 */

export * from "./media-parser.js";
export * from "./media-io.js";

export {
  parseMediaDirectives,
  expandHomePath,
  type ParseMediaDirectivesResult,
} from "./parse-directives.js";

export {
  extractLocalFilePathsFromText,
  extractLocalImagePathsFromText,
  type ExtractLocalImagePathsParams,
} from "./local-path-inference.js";

export {
  resolveOutboundMedia,
  isHttpMediaUrl,
  isImageContentType,
  type ResolvedOutboundMedia,
  type ResolveOutboundMediaParams,
} from "./resolve-outbound.js";
