import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithSsrFGuard = vi.hoisted(() => vi.fn());
vi.mock("../runtime/runtime-api.js", () => ({ fetchWithSsrFGuard }));

import { downloadGuardedHttpMedia, readResponseBodyBounded } from "./http-media.js";

function streamingResponse(chunks: string[], headers?: Record<string, string>): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
        controller.close();
      },
    }),
    { status: 200, headers },
  );
}

beforeEach(() => fetchWithSsrFGuard.mockReset());

describe("远程媒体有界读取", () => {
  it("在预算内按流读取并拼接响应", async () => {
    const result = await readResponseBodyBounded(streamingResponse(["hello", "-world"]), 11);
    expect(result.toString("utf8")).toBe("hello-world");
  });

  it("Content-Length 已声明超限时不读取响应体", async () => {
    await expect(
      readResponseBodyBounded(streamingResponse(["small"], { "content-length": "999" }), 10),
    ).rejects.toThrow("media exceeds configured limit");
  });

  it("服务端省略 Content-Length 时仍按实际流量拒绝超限", async () => {
    await expect(
      readResponseBodyBounded(streamingResponse(["12345", "67890", "x"]), 10),
    ).rejects.toThrow("media exceeds configured limit");
  });

  it("HTTP 状态失败时仍释放 SSRF Guard 连接资源", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    fetchWithSsrFGuard.mockResolvedValue({
      response: new Response("failed", { status: 503 }),
      release,
    });

    await expect(
      downloadGuardedHttpMedia({ url: "https://example.test/file", maxBytes: 1024 }),
    ).rejects.toThrow("HTTP 503");
    expect(release).toHaveBeenCalledOnce();
  });

  it("返回受限正文与内容类型，并在成功后释放资源", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    fetchWithSsrFGuard.mockResolvedValue({
      response: streamingResponse(["image"], { "content-type": "image/png" }),
      release,
    });

    await expect(
      downloadGuardedHttpMedia({ url: "https://example.test/image", maxBytes: 10 }),
    ).resolves.toMatchObject({ contentType: "image/png", buffer: Buffer.from("image") });
    expect(release).toHaveBeenCalledOnce();
  });
});
