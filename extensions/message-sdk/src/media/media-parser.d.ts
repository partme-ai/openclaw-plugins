/**
 * 媒体解析器 — Markdown/HTML/MEDIA:指令/裸露路径的媒体提取引擎
 *
 * 来源：openclaw-china packages/shared/src/media/media-parser.ts (723行)
 * 适配：独立 TypeScript 模块，不依赖 openclaw-china/shared
 */
export type MediaType = "image" | "audio" | "video" | "file";
export type MediaSourceKind = "markdown" | "markdown-linked" | "html" | "bare";
export interface ExtractedMedia {
    source: string;
    localPath?: string;
    type: MediaType;
    isLocal: boolean;
    isHttp: boolean;
    fileName?: string;
    sourceKind?: MediaSourceKind;
}
export interface MediaParseResult {
    text: string;
    images: ExtractedMedia[];
    files: ExtractedMedia[];
    all: ExtractedMedia[];
}
export interface MediaParseOptions {
    removeFromText?: boolean;
    checkExists?: boolean;
    existsSync?: (path: string) => boolean;
    parseMediaLines?: boolean;
    parseMarkdownImages?: boolean;
    parseHtmlImages?: boolean;
    parseBarePaths?: boolean;
    parseMarkdownLinks?: boolean;
}
export declare const IMAGE_EXTENSIONS: Set<string>;
export declare const AUDIO_EXTENSIONS: Set<string>;
export declare const VIDEO_EXTENSIONS: Set<string>;
export declare const NON_IMAGE_EXTENSIONS: Set<string>;
export declare function isHttpUrl(value: string): boolean;
export declare function isFileUrl(value: string): boolean;
export declare function isLocalReference(raw: string): boolean;
export declare function normalizeLocalPath(raw: string): string;
export declare function stripTitleFromUrl(value: string): string;
export declare function getExtension(filePath: string): string;
export declare function isImagePath(filePath: string): boolean;
export declare function isNonImageFilePath(filePath: string): boolean;
export declare function detectMediaTypeFromPath(filePath: string): MediaType;
export declare function extractMediaFromText(text: string, options?: MediaParseOptions): MediaParseResult;
export declare function extractImagesFromText(text: string, options?: Omit<MediaParseOptions, "parseMarkdownLinks">): {
    text: string;
    images: ExtractedMedia[];
};
export declare function extractFilesFromText(text: string, options?: Omit<MediaParseOptions, "parseMarkdownImages" | "parseHtmlImages">): {
    text: string;
    files: ExtractedMedia[];
};
//# sourceMappingURL=media-parser.d.ts.map