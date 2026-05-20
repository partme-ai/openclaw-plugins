/**
 * 媒体 IO 模块
 *
 * 统一的媒体文件下载、读取、归档和清理功能。
 * 来源：openclaw-china packages/shared/src/media/media-io.ts (746行)
 */
export interface MediaReadResult {
    buffer: Buffer;
    fileName: string;
    size: number;
    mimeType?: string;
}
export interface DownloadToTempFileResult {
    path: string;
    fileName: string;
    contentType: string;
    size: number;
    sourceFileName?: string;
}
export interface MediaReadOptions {
    timeout?: number;
    maxSize?: number;
    fetch?: typeof globalThis.fetch;
}
export interface DownloadToTempFileOptions extends MediaReadOptions {
    tempDir?: string;
    tempPrefix?: string;
    sourceFileName?: string;
}
export interface FinalizeInboundMediaOptions {
    filePath: string;
    tempDir: string;
    inboundDir: string;
}
export interface PruneInboundMediaDirOptions {
    inboundDir: string;
    keepDays: number;
    nowMs?: number;
}
export interface PathSecurityOptions {
    allowedPrefixes?: string[];
    maxPathLength?: number;
    preventTraversal?: boolean;
}
export declare class FileSizeLimitError extends Error {
    readonly actualSize: number;
    readonly limitSize: number;
    constructor(message: string, actualSize: number, limitSize: number);
}
export declare class MediaTimeoutError extends Error {
    readonly timeoutMs: number;
    constructor(message: string, timeoutMs: number);
}
export declare class PathSecurityError extends Error {
    readonly unsafePath: string;
    readonly reason: string;
    constructor(message: string, unsafePath: string, reason: string);
}
export declare function getMimeType(filePath: string): string | undefined;
export declare function validatePathSecurity(filePath: string, options?: PathSecurityOptions): void;
export declare function getDefaultAllowedPrefixes(): string[];
export declare function fetchMediaFromUrl(url: string, options?: MediaReadOptions): Promise<MediaReadResult>;
export declare function downloadToTempFile(url: string, options?: DownloadToTempFileOptions): Promise<DownloadToTempFileResult>;
export declare function readMediaFromLocal(filePath: string, options?: MediaReadOptions & PathSecurityOptions): Promise<MediaReadResult>;
export declare function readMedia(source: string, options?: MediaReadOptions & PathSecurityOptions): Promise<MediaReadResult>;
export declare function readMediaBatch(sources: string[], options?: MediaReadOptions & PathSecurityOptions): Promise<Array<{
    source: string;
    result?: MediaReadResult;
    error?: Error;
}>>;
export declare function finalizeInboundMediaFile(options: FinalizeInboundMediaOptions): Promise<string>;
export declare function pruneInboundMediaDir(options: PruneInboundMediaDirOptions): Promise<void>;
export declare function cleanupFileSafe(filePath: string | undefined, onError?: (error: unknown, filePath: string) => void): Promise<void>;
//# sourceMappingURL=media-io.d.ts.map