/**
 * 文件工具 — 扩展名解析、MIME 映射、文件分类
 *
 * 来源：openclaw-china packages/shared/src/file/file-utils.ts (284行)
 */

// ============================================================================
// 类型
// ============================================================================

export type FileCategory = "image" | "audio" | "video" | "document" | "archive" | "code" | "other";

// ============================================================================
// MIME → 扩展名
// ============================================================================

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp", "image/bmp": ".bmp",
  "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/ogg": ".ogg", "audio/amr": ".amr", "audio/x-m4a": ".m4a",
  "video/mp4": ".mp4", "video/quicktime": ".mov", "video/x-msvideo": ".avi", "video/webm": ".webm",
  "application/pdf": ".pdf", "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt", "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/rtf": ".rtf", "application/vnd.oasis.opendocument.text": ".odt", "application/vnd.oasis.opendocument.spreadsheet": ".ods",
  "text/plain": ".txt", "text/markdown": ".md", "text/csv": ".csv",
  "application/zip": ".zip", "application/x-rar-compressed": ".rar", "application/vnd.rar": ".rar",
  "application/x-7z-compressed": ".7z", "application/x-tar": ".tar", "application/gzip": ".gz",
  "application/x-gzip": ".gz", "application/x-bzip2": ".bz2",
  "application/json": ".json", "application/xml": ".xml", "text/xml": ".xml", "text/html": ".html",
  "text/css": ".css", "text/javascript": ".js", "application/javascript": ".js",
  "text/x-python": ".py", "text/x-java-source": ".java", "text/x-c": ".c", "text/x-yaml": ".yaml", "application/x-yaml": ".yaml",
};

// ============================================================================
// MIME/扩展名 → 分类
// ============================================================================

const CATEGORY_BY_MIME: Record<string, FileCategory> = {
  "application/pdf": "document", "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.ms-powerpoint": "document", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
  "application/rtf": "document", "application/vnd.oasis.opendocument.text": "document",
  "application/vnd.oasis.opendocument.spreadsheet": "document", "text/plain": "document", "text/markdown": "document", "text/csv": "document",
  "application/zip": "archive", "application/x-rar-compressed": "archive", "application/vnd.rar": "archive",
  "application/x-7z-compressed": "archive", "application/x-tar": "archive", "application/gzip": "archive",
  "application/x-gzip": "archive", "application/x-bzip2": "archive",
  "application/json": "code", "application/xml": "code", "text/xml": "code", "text/html": "code",
  "text/css": "code", "text/javascript": "code", "application/javascript": "code",
  "text/x-python": "code", "text/x-java-source": "code", "text/x-c": "code", "text/x-yaml": "code", "application/x-yaml": "code",
};

const CATEGORY_BY_EXTENSION: Record<string, FileCategory> = {
  ".jpg": "image", ".jpeg": "image", ".png": "image", ".gif": "image", ".webp": "image", ".bmp": "image",
  ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".m4a": "audio", ".amr": "audio",
  ".mp4": "video", ".mov": "video", ".avi": "video", ".mkv": "video", ".webm": "video",
  ".pdf": "document", ".doc": "document", ".docx": "document", ".txt": "document", ".md": "document",
  ".rtf": "document", ".odt": "document", ".xls": "document", ".xlsx": "document", ".csv": "document",
  ".ods": "document", ".ppt": "document", ".pptx": "document",
  ".zip": "archive", ".rar": "archive", ".7z": "archive", ".tar": "archive", ".gz": "archive", ".bz2": "archive",
  ".py": "code", ".js": "code", ".ts": "code", ".jsx": "code", ".tsx": "code", ".java": "code",
  ".cpp": "code", ".c": "code", ".go": "code", ".rs": "code",
  ".json": "code", ".xml": "code", ".yaml": "code", ".yml": "code", ".html": "code", ".css": "code",
};

// ============================================================================
// API
// ============================================================================

function extractExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1 || lastDot === fileName.length - 1) return "";
  return fileName.slice(lastDot).toLowerCase();
}

/**
 * 根据 MIME 类型和文件名分类文件
 *
 * 优先级: MIME前缀 > 精确MIME映射 > 扩展名映射 > "other"
 */
export function resolveFileCategory(contentType: string, fileName?: string): FileCategory {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime in CATEGORY_BY_MIME) return CATEGORY_BY_MIME[mime];
  if (fileName) { const ext = extractExtension(fileName); if (ext && ext in CATEGORY_BY_EXTENSION) return CATEGORY_BY_EXTENSION[ext]; }
  return "other";
}

/**
 * 从 MIME 类型或文件名解析扩展名
 *
 * 优先级: fileName扩展名 > MIME映射 > ".bin"
 */
export function resolveExtension(contentType: string, fileName?: string): string {
  if (fileName) { const ext = extractExtension(fileName); if (ext) return ext; }
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (mime in MIME_TO_EXTENSION) return MIME_TO_EXTENSION[mime];
  return ".bin";
}
