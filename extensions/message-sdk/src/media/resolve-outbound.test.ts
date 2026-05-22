import { describe, expect, it, vi } from "vitest";
import {
  isHttpMediaUrl,
  isImageContentType,
  resolveOutboundMedia,
} from "./resolve-outbound.js";

describe("resolve-outbound", () => {
  it("detects http urls", () => {
    expect(isHttpMediaUrl("https://x/a.png")).toBe(true);
    expect(isHttpMediaUrl("/tmp/a.png")).toBe(false);
  });

  it("loads local file", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmp = path.join(os.tmpdir(), `sdk-media-${Date.now()}.txt`);
    await fs.writeFile(tmp, "hi");
    const r = await resolveOutboundMedia({ pathOrUrl: tmp, mimeByExt: { txt: "text/plain" } });
    expect(r.buffer.toString()).toBe("hi");
    expect(r.contentType).toBe("text/plain");
    await fs.unlink(tmp).catch(() => undefined);
  });

  it("loads remote via injected fetcher", async () => {
    const fetchRemoteMedia = vi.fn(async () => ({
      buffer: Buffer.from("x"),
      contentType: "image/png",
      fileName: "a.png",
    }));
    const r = await resolveOutboundMedia({
      pathOrUrl: "https://example.com/a.png",
      fetchRemoteMedia,
    });
    expect(r.filename).toBe("a.png");
    expect(isImageContentType(r.contentType)).toBe(true);
  });
});
