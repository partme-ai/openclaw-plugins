/**
 * 媒体模块 — 媒体解析 + IO
 *
 * 来源：openclaw-china packages/shared/src/media/ (MIT License)
 * 版权：原始版权归 openclaw-china 项目所有
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
