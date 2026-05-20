/**
 * 媒体解析器 单元测试 — 6 种提取策略 + 路径工具
 */
import { describe, it, expect } from "vitest";
import {
  isHttpUrl,
  isLocalReference,
  normalizeLocalPath,
  getExtension,
  isImagePath,
  isNonImageFilePath,
  detectMediaTypeFromPath,
  extractMediaFromText,
  extractImagesFromText,
  extractFilesFromText,
  type ExtractedMedia,
  type MediaParseResult,
} from "./media-parser.ts";

// ============================================================================
// isHttpUrl
// ============================================================================

describe("isHttpUrl", () => {
  it("识别 HTTP URL", () => {
    expect(isHttpUrl("http://example.com/file.png")).toBe(true);
    expect(isHttpUrl("https://cdn.com/data.pdf")).toBe(true);
  });

  it("非 URL 返回 false", () => {
    expect(isHttpUrl("/tmp/file.png")).toBe(false);
    expect(isHttpUrl("file:///tmp/file.png")).toBe(false);
    expect(isHttpUrl("MEDIA:/tmp/file.png")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(isHttpUrl("HTTP://example.com")).toBe(true);
    expect(isHttpUrl("HTTPS://example.com")).toBe(true);
  });
});

// ============================================================================
// isLocalReference
// ============================================================================

describe("isLocalReference", () => {
  it("file:// URL 是本地引用", () => {
    expect(isLocalReference("file:///tmp/data.csv")).toBe(true);
  });

  it("MEDIA: 前缀是本地引用", () => {
    expect(isLocalReference("MEDIA:/tmp/photo.png")).toBe(true);
  });

  it("attachment:// 是本地引用", () => {
    expect(isLocalReference("attachment://file.pdf")).toBe(true);
  });

  it("绝对路径是本地引用", () => {
    expect(isLocalReference("/tmp/file.png")).toBe(true);
    expect(isLocalReference("/Users/wandl/data.csv")).toBe(true);
  });

  it("~ 路径是本地引用", () => {
    expect(isLocalReference("~/Documents/file.pdf")).toBe(true);
  });

  it("HTTP URL 不是本地引用", () => {
    expect(isLocalReference("https://cdn.com/file.png")).toBe(false);
  });

  it("相对路径不是本地引用", () => {
    expect(isLocalReference("./file.png")).toBe(false);
    expect(isLocalReference("file.png")).toBe(false);
  });
});

// ============================================================================
// normalizeLocalPath
// ============================================================================

describe("normalizeLocalPath", () => {
  it("标准化 file:// URL", () => {
    const result = normalizeLocalPath("file:///tmp/test.png");
    expect(result).toBe("/tmp/test.png");
  });

  it("剥离 MEDIA: 前缀", () => {
    const path = normalizeLocalPath("MEDIA:/tmp/photo.jpg");
    expect(path).toBe("/tmp/photo.jpg");
  });

  it("展开 ~ 路径", () => {
    const result = normalizeLocalPath("~/test.txt");
    expect(result).toContain("/test.txt");
    expect(result).not.toContain("~");
  });

  it("相对路径转为绝对路径", () => {
    const result = normalizeLocalPath("./data.csv");
    expect(result.startsWith("/")).toBe(true);
  });
});

// ============================================================================
// getExtension / isImagePath / isNonImageFilePath
// ============================================================================

describe("getExtension", () => {
  it("提取扩展名", () => {
    expect(getExtension("file.png")).toBe("png");
    expect(getExtension("data.tar.gz")).toBe("gz");
    expect(getExtension("noext")).toBe("");
  });

  it("大小写不敏感", () => {
    expect(getExtension("PHOTO.JPG")).toBe("jpg");
  });
});

describe("isImagePath", () => {
  it("图片扩展名", () => {
    expect(isImagePath("photo.png")).toBe(true);
    expect(isImagePath("logo.svg")).toBe(true);
    expect(isImagePath("scan.heic")).toBe(true);
  });

  it("非图片扩展名", () => {
    expect(isImagePath("doc.pdf")).toBe(false);
    expect(isImagePath("song.mp3")).toBe(false);
    expect(isImagePath("video.mp4")).toBe(false);
  });
});

describe("isNonImageFilePath", () => {
  it("文档扩展名", () => {
    expect(isNonImageFilePath("doc.pdf")).toBe(true);
    expect(isNonImageFilePath("sheet.xlsx")).toBe(true);
  });

  it("音视频扩展名", () => {
    expect(isNonImageFilePath("song.mp3")).toBe(true);
    expect(isNonImageFilePath("video.mp4")).toBe(true);
  });

  it("压缩包扩展名", () => {
    expect(isNonImageFilePath("bundle.zip")).toBe(true);
  });

  it("图片返回 false", () => {
    expect(isNonImageFilePath("photo.png")).toBe(false);
  });

  it("未知扩展名返回 false", () => {
    expect(isNonImageFilePath("script.ts")).toBe(false);
  });
});

// ============================================================================
// detectMediaTypeFromPath
// ============================================================================

describe("detectMediaTypeFromPath", () => {
  it("根据扩展名识别类型", () => {
    expect(detectMediaTypeFromPath("img.png")).toBe("image");
    expect(detectMediaTypeFromPath("song.mp3")).toBe("audio");
    expect(detectMediaTypeFromPath("video.mp4")).toBe("video");
    expect(detectMediaTypeFromPath("doc.pdf")).toBe("file");
    expect(detectMediaTypeFromPath("script.ts")).toBe("file");
  });
});

// ============================================================================
// extractMediaFromText — 6 种提取策略
// ============================================================================

describe("extractMediaFromText", () => {
  // ── 策略 1: Markdown linked images ──
  it("提取 Markdown 链接图片 [![]()]()", () => {
    const result = extractMediaFromText("[![alt](photo.png)](large.png)", { parseBarePaths: false, parseMarkdownLinks: false });
    expect(result.images).toHaveLength(1);
    expect(result.images[0].source).toBe("photo.png");
  });

  // ── 策略 2: Markdown images ──
  it("提取 Markdown 图片 ![]()", () => {
    const result = extractMediaFromText("![screenshot](screen.png) 和 ![logo](logo.svg)", { parseBarePaths: false, parseMarkdownLinks: false });
    expect(result.images).toHaveLength(2);
    expect(result.images[0].source).toBe("screen.png");
    expect(result.images[1].source).toBe("logo.svg");
  });

  it("可选保留图片标记在文本中", () => {
    const result = extractMediaFromText("![img](photo.png)", { removeFromText: false, parseBarePaths: false });
    expect(result.text).toContain("![img](photo.png)");
    expect(result.images).toHaveLength(1);
  });

  // ── 策略 3: HTML img ──
  it("提取 HTML img 标签", () => {
    const result = extractMediaFromText('<img src="photo.jpg" alt="图">', { parseBarePaths: false, parseMarkdownLinks: false });
    expect(result.images).toHaveLength(1);
    expect(result.images[0].source).toBe("photo.jpg");
  });

  it("提取带单引号的 HTML img", () => {
    const result = extractMediaFromText("<img src='img.png'>", { parseBarePaths: false, parseMarkdownLinks: false });
    expect(result.images).toHaveLength(1);
  });

  // ── 策略 4: Markdown links (文件) ──
  it("提取本地文件的 Markdown 链接", () => {
    const result = extractMediaFromText("[下载报告](/tmp/report.pdf)", { parseMarkdownImages: false, parseHtmlImages: false });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].source).toBe("/tmp/report.pdf");
    expect(result.files[0].type).toBe("file");
  });

  it("跳过图片的 Markdown 链接（在策略2中处理）", () => {
    const result = extractMediaFromText("[图片](/tmp/photo.png)", {});
    // Photo.jpg 在策略2已被处理为 image，策略4不应重复
    const fileRefs = result.files.filter((f) => f.source === "/tmp/photo.png");
    expect(fileRefs).toHaveLength(0);
  });

  // ── 策略 5: Bare image paths ──
  it("提取裸本地图片路径", () => {
    const result = extractMediaFromText("参考 /tmp/screenshot.png 中的内容", { parseMarkdownLinks: false });
    // 裸路径会在策略2和策略5之间协调，但大概率被捕获
    const allSources = result.all.map((m) => m.source);
    expect(allSources.some((s) => s.includes("screenshot.png"))).toBe(true);
  });

  // ── 策略 6: Bare file paths ──
  it("提取裸本地文件路径", () => {
    const result = extractMediaFromText("见 /tmp/data.csv 了解详情", { parseMarkdownImages: false, parseHtmlImages: false });
    expect(result.files.some((f) => f.source === "/tmp/data.csv")).toBe(true);
  });

  // ── 综合测试 ──
  it("一次提取多种来源", () => {
    const text = `分析报告:
![chart](chart.png)
数据源: /tmp/raw-data.csv
<img src="logo.jpg">
MEDIA: /tmp/archive.zip
`;
    const result = extractMediaFromText(text);
    expect(result.all.length).toBeGreaterThanOrEqual(3);
  });

  it("返回 all 包含所有媒体", () => {
    const result = extractMediaFromText("![a](1.png) /tmp/doc.pdf");
    expect(result.all).toHaveLength(result.images.length + result.files.length);
  });

  it("removeFromText 清理多余空行", () => {
    const result = extractMediaFromText("开头\n![img](photo.png)\n\n\n结尾");
    expect(result.text).not.toContain("\n\n\n");
    expect(result.text).toContain("开头");
    expect(result.text).toContain("结尾");
  });

  it("空文本返回空结果", () => {
    const result = extractMediaFromText("");
    expect(result.text).toBe("");
    expect(result.images).toEqual([]);
    expect(result.files).toEqual([]);
    expect(result.all).toEqual([]);
  });

  it("无媒体的纯文本原样返回", () => {
    const result = extractMediaFromText("这是一段纯文本");
    expect(result.text).toBe("这是一段纯文本");
    expect(result.all).toEqual([]);
  });
});

// ============================================================================
// extractImagesFromText
// ============================================================================

describe("extractImagesFromText", () => {
  it("只提取图片", () => {
    const { images, text } = extractImagesFromText("![img](photo.png) [文件](/tmp/doc.pdf)");
    expect(images).toHaveLength(1);
    expect(images[0].type).toBe("image");
  });

  it("不提取文件链接", () => {
    const { images } = extractImagesFromText("[文档](/tmp/doc.pdf)");
    expect(images).toHaveLength(0);
  });
});

// ============================================================================
// extractFilesFromText
// ============================================================================

describe("extractFilesFromText", () => {
  it("只提取文件", () => {
    const { files } = extractFilesFromText("[文档](/tmp/report.pdf) /tmp/data.csv");
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.every((f) => f.type !== "image")).toBe(true);
  });

  it("不提取 Markdown 图片", () => {
    const { files } = extractFilesFromText("![img](photo.png)");
    expect(files).toHaveLength(0);
  });
});

// ============================================================================
// ExtractedMedia 结构
// ============================================================================

describe("ExtractedMedia 结构完整性", () => {
  it("HTTP 图片的 ExtractedMedia 字段", () => {
    const result = extractMediaFromText("![img](https://cdn.example.com/photo.jpg)");
    expect(result.images).toHaveLength(1);
    const media = result.images[0];
    expect(media.source).toBe("https://cdn.example.com/photo.jpg");
    expect(media.type).toBe("image");
    expect(media.isHttp).toBe(true);
    expect(media.isLocal).toBe(false);
    expect(media.sourceKind).toBe("markdown");
    expect(media.fileName).toBe("photo.jpg");
  });

  it("本地文件的 ExtractedMedia 字段", () => {
    const result = extractMediaFromText("[文档](/tmp/report.pdf)", { parseMarkdownImages: false, parseHtmlImages: false });
    expect(result.files).toHaveLength(1);
    const media = result.files[0];
    expect(media.type).toBe("file");
    expect(media.isHttp).toBe(false);
    expect(media.isLocal).toBe(true);
    expect(media.sourceKind).toBe("markdown");
    expect(media.localPath).toBe("/tmp/report.pdf");
    expect(media.fileName).toBe("report.pdf");
  });
});
