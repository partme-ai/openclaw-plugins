/**
 * 文件工具 — 扩展名解析、MIME 映射、文件分类
 *
 * 来源：openclaw-china packages/shared/src/file/file-utils.ts (284行)
 */
export type FileCategory = "image" | "audio" | "video" | "document" | "archive" | "code" | "other";
/**
 * 根据 MIME 类型和文件名分类文件
 *
 * 优先级: MIME前缀 > 精确MIME映射 > 扩展名映射 > "other"
 */
export declare function resolveFileCategory(contentType: string, fileName?: string): FileCategory;
/**
 * 从 MIME 类型或文件名解析扩展名
 *
 * 优先级: fileName扩展名 > MIME映射 > ".bin"
 */
export declare function resolveExtension(contentType: string, fileName?: string): string;
//# sourceMappingURL=file-utils.d.ts.map