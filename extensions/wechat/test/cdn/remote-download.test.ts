import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { guardedFetch, release } = vi.hoisted(() => ({
  guardedFetch: vi.fn(),
  release: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("openclaw/plugin-sdk/ssrf-runtime", () => ({
  fetchWithSsrFGuard: guardedFetch,
}));

vi.mock("../../src/util/logger.js", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  downloadRemoteImageToTemp,
  withRemoteMediaTempFile,
} from "../../src/cdn/upload.js";

const cleanup: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  release.mockResolvedValue(undefined);
});

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((entry) => fs.rm(entry, { recursive: true, force: true })),
  );
});

describe("guarded remote media download", () => {
  it("uses OpenClaw SSRF Guard and releases its dispatcher after success", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "weixin-remote-"));
    cleanup.push(dir);
    guardedFetch.mockResolvedValueOnce({
      response: new Response(Buffer.from("image"), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
      release,
    });

    const filePath = await downloadRemoteImageToTemp(
      "https://images.example/photo.png",
      dir,
    );

    expect(guardedFetch).toHaveBeenCalledWith({
      url: "https://images.example/photo.png",
      timeoutMs: 30_000,
    });
    expect(await fs.readFile(filePath, "utf8")).toBe("image");
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases the guard after HTTP failure and propagates SSRF rejection", async () => {
    guardedFetch.mockResolvedValueOnce({
      response: new Response("missing", {
        status: 404,
        statusText: "Not Found",
      }),
      release,
    });
    await expect(
      downloadRemoteImageToTemp(
        "https://images.example/missing.png",
        os.tmpdir(),
      ),
    ).rejects.toThrow("remote media download failed");
    expect(release).toHaveBeenCalledOnce();

    guardedFetch.mockRejectedValueOnce(
      new Error("SSRF blocked private address"),
    );
    await expect(
      downloadRemoteImageToTemp(
        "https://dns-rebind.example/photo.png",
        os.tmpdir(),
      ),
    ).rejects.toThrow("SSRF blocked private address");
  });

  it("removes the temporary file after callback success and failure", async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "weixin-remote-lifecycle-"),
    );
    cleanup.push(dir);
    const response = () => ({
      response: new Response(Buffer.from("temporary"), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
      release,
    });

    guardedFetch.mockResolvedValueOnce(response());
    let successfulPath = "";
    await withRemoteMediaTempFile({
      url: "https://files.example/success.bin",
      destDir: dir,
      use: async (filePath) => {
        successfulPath = filePath;
        expect(await fs.readFile(filePath, "utf8")).toBe("temporary");
        return "sent";
      },
    });
    await expect(fs.stat(successfulPath)).rejects.toMatchObject({
      code: "ENOENT",
    });

    guardedFetch.mockResolvedValueOnce(response());
    let failedPath = "";
    await expect(
      withRemoteMediaTempFile({
        url: "https://files.example/failure.bin",
        destDir: dir,
        use: async (filePath) => {
          failedPath = filePath;
          throw new Error("upload failed");
        },
      }),
    ).rejects.toThrow("upload failed");
    await expect(fs.stat(failedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
