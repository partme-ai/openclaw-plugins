/**
 * 媒体 IO 安全与资源边界测试。
 *
 * 重点验证下载不是“读完再检查”、失败不遗留临时文件、路径白名单按目录边界而非字符串
 * 前缀判断，以及符号链接不能把本地读取带出允许目录。
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadToTempFile,
  fetchMediaFromUrl,
  FileSizeLimitError,
  PathSecurityError,
  readMediaFromLocal,
  validatePathSecurity,
} from "./media-io.js";

function streamingResponse(chunks: string[], headers?: Record<string, string>): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers },
  );
}

describe("media-io security boundaries", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tmpDirs.length = 0;
  });

  it("uses directory boundaries for allowedPrefixes", () => {
    const allowed = path.join(os.tmpdir(), "media-allowed");
    expect(() => validatePathSecurity(path.join(allowed, "a.png"), { allowedPrefixes: [allowed] }))
      .not.toThrow();
    expect(() => validatePathSecurity(path.join(`${allowed}-evil`, "a.png"), { allowedPrefixes: [allowed] }))
      .toThrow(PathSecurityError);
    expect(() => validatePathSecurity(path.join(allowed, "report..final.png"), { allowedPrefixes: [allowed] }))
      .not.toThrow();
  });

  it("rejects a local symlink that resolves outside an allowed prefix", async () => {
    if (process.platform === "win32") return;
    const allowed = await fs.mkdtemp(path.join(os.tmpdir(), "media-allowed-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "media-outside-"));
    tmpDirs.push(allowed, outside);
    const secret = path.join(outside, "secret.txt");
    await fs.writeFile(secret, "secret", "utf8");
    const link = path.join(allowed, "link.txt");
    await fs.symlink(secret, link);

    await expect(readMediaFromLocal(link, { allowedPrefixes: [allowed] }))
      .rejects.toMatchObject({ reason: "symlink escape" });
  });

  it("stops an in-memory download as soon as the streamed body exceeds maxSize", async () => {
    const customFetch = vi.fn(async () => streamingResponse(["1234", "5678"]));
    await expect(
      fetchMediaFromUrl("https://cdn.example.test/file.bin", { maxSize: 5, fetch: customFetch }),
    ).rejects.toBeInstanceOf(FileSizeLimitError);
    expect(customFetch).toHaveBeenCalledOnce();
  });

  it("removes a partial temp file when a streaming download exceeds maxSize", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "media-download-"));
    tmpDirs.push(tempDir);
    const customFetch = vi.fn(async () => streamingResponse(["1234", "5678"], {
      "content-type": "application/octet-stream",
    }));

    await expect(
      downloadToTempFile("https://cdn.example.test/file.bin", {
        tempDir,
        maxSize: 5,
        fetch: customFetch,
      }),
    ).rejects.toBeInstanceOf(FileSizeLimitError);
    await expect(fs.readdir(tempDir)).resolves.toEqual([]);
  });

  it("writes successful downloads with private permissions and exact content", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "media-download-"));
    tmpDirs.push(tempDir);
    const result = await downloadToTempFile("https://cdn.example.test/file.txt", {
      tempDir,
      fetch: vi.fn(async () => streamingResponse(["hello", " world"], {
        "content-type": "text/plain",
      })),
    });

    await expect(fs.readFile(result.path, "utf8")).resolves.toBe("hello world");
    expect(result.size).toBe(11);
    const stat = await fs.stat(result.path);
    if (process.platform !== "win32") expect(stat.mode & 0o777).toBe(0o600);
  });

  it("uses the SSRF guard when no custom fetch implementation is supplied", async () => {
    await expect(fetchMediaFromUrl("http://127.0.0.1/private.png"))
      .rejects.toThrow(/safeFetch: blocked URL/);
  });
});
