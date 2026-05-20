/**
 * 文件工具 单元测试 — 扩展名解析、MIME 映射、文件分类
 */
import { describe, it, expect } from "vitest";
import { resolveFileCategory, resolveExtension, type FileCategory } from "./file-utils.ts";

// ============================================================================
// resolveFileCategory
// ============================================================================

describe("resolveFileCategory", () => {
  it("MIME 前缀识别 image", () => {
    expect(resolveFileCategory("image/png")).toBe("image");
    expect(resolveFileCategory("image/jpeg")).toBe("image");
    expect(resolveFileCategory("image/webp")).toBe("image");
    expect(resolveFileCategory("image/svg+xml")).toBe("image");
  });

  it("MIME 前缀识别 audio", () => {
    expect(resolveFileCategory("audio/mpeg")).toBe("audio");
    expect(resolveFileCategory("audio/wav")).toBe("audio");
    expect(resolveFileCategory("audio/ogg")).toBe("audio");
  });

  it("MIME 前缀识别 video", () => {
    expect(resolveFileCategory("video/mp4")).toBe("video");
    expect(resolveFileCategory("video/webm")).toBe("video");
    expect(resolveFileCategory("video/quicktime")).toBe("video");
  });

  it("精确 MIME 映射 document", () => {
    expect(resolveFileCategory("application/pdf")).toBe("document");
    expect(resolveFileCategory("application/msword")).toBe("document");
    expect(resolveFileCategory("application/vnd.ms-excel")).toBe("document");
    expect(resolveFileCategory("text/plain")).toBe("document");
    expect(resolveFileCategory("text/markdown")).toBe("document");
    expect(resolveFileCategory("text/csv")).toBe("document");
  });

  it("精确 MIME 映射 archive", () => {
    expect(resolveFileCategory("application/zip")).toBe("archive");
    expect(resolveFileCategory("application/x-rar-compressed")).toBe("archive");
    expect(resolveFileCategory("application/x-7z-compressed")).toBe("archive");
    expect(resolveFileCategory("application/gzip")).toBe("archive");
  });

  it("精确 MIME 映射 code", () => {
    expect(resolveFileCategory("application/json")).toBe("code");
    expect(resolveFileCategory("text/javascript")).toBe("code");
    expect(resolveFileCategory("text/html")).toBe("code");
    expect(resolveFileCategory("text/x-python")).toBe("code");
  });

  it("从文件名扩展名回退", () => {
    // MIME 不在精确映射中，但有 .png 文件名
    expect(resolveFileCategory("application/octet-stream", "photo.png")).toBe("image");
    expect(resolveFileCategory("application/octet-stream", "song.mp3")).toBe("audio");
    expect(resolveFileCategory("application/octet-stream", "movie.mp4")).toBe("video");
    expect(resolveFileCategory("application/octet-stream", "doc.pdf")).toBe("document");
    expect(resolveFileCategory("application/octet-stream", "bundle.zip")).toBe("archive");
    expect(resolveFileCategory("application/octet-stream", "app.ts")).toBe("code");
  });

  it("都匹配不上返回 other", () => {
    expect(resolveFileCategory("application/x-unknown")).toBe("other");
    expect(resolveFileCategory("application/octet-stream")).toBe("other");
  });

  it("处理带参数 MIME（如 charset）", () => {
    expect(resolveFileCategory("text/plain; charset=utf-8")).toBe("document");
    expect(resolveFileCategory("application/json; charset=utf-8")).toBe("code");
  });

  it("无文件名时的回退", () => {
    expect(resolveFileCategory("application/octet-stream")).toBe("other");
    expect(resolveFileCategory("image/png")).toBe("image"); // 前缀优先
  });

  it("大小写不敏感", () => {
    expect(resolveFileCategory("IMAGE/PNG")).toBe("image");
    expect(resolveFileCategory("Audio/MPEG")).toBe("audio");
    expect(resolveFileCategory("VIDEO/MP4")).toBe("video");
  });

  it("无扩展名文件名回退", () => {
    expect(resolveFileCategory("application/octet-stream", "noext")).toBe("other");
  });
});

// ============================================================================
// resolveExtension
// ============================================================================

describe("resolveExtension", () => {
  it("从文件名优先提取", () => {
    expect(resolveExtension("image/png", "photo.jpg")).toBe(".jpg");
    expect(resolveExtension("application/octet-stream", "doc.pdf")).toBe(".pdf");
  });

  it("无文件名从 MIME 映射", () => {
    expect(resolveExtension("image/jpeg")).toBe(".jpg");
    expect(resolveExtension("image/png")).toBe(".png");
    expect(resolveExtension("audio/mpeg")).toBe(".mp3");
    expect(resolveExtension("video/mp4")).toBe(".mp4");
    expect(resolveExtension("application/pdf")).toBe(".pdf");
    expect(resolveExtension("application/msword")).toBe(".doc");
    expect(resolveExtension("application/zip")).toBe(".zip");
    expect(resolveExtension("text/plain")).toBe(".txt");
    expect(resolveExtension("application/json")).toBe(".json");
  });

  it("MIME 带 charset 参数", () => {
    expect(resolveExtension("text/plain; charset=utf-8")).toBe(".txt");
  });

  it("未知类型回退 .bin", () => {
    expect(resolveExtension("application/x-custom")).toBe(".bin");
    expect(resolveExtension("")).toBe(".bin");
  });

  it("Office 文档 MIME 映射", () => {
    expect(resolveExtension("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(".docx");
    expect(resolveExtension("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(".xlsx");
    expect(resolveExtension("application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe(".pptx");
  });
});
