import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  readRequestBodyWithLimit,
  RequestBodyLimitError,
  isRequestBodyLimitError,
} from "./body-limit.js";

function mockReq(chunks: Buffer[], contentLength?: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & { destroy: () => void };
  req.headers = contentLength ? { "content-length": contentLength } : {};
  req.destroy = () => {
    req.removeAllListeners();
  };
  setImmediate(() => {
    for (const c of chunks) req.emit("data", c);
    req.emit("end");
  });
  return req;
}

describe("readRequestBodyWithLimit", () => {
  it("reads body within limit", async () => {
    const body = await readRequestBodyWithLimit(mockReq([Buffer.from('{"ok":true}')]), {
      maxBytes: 1024,
      timeoutMs: 2000,
    });
    expect(body).toBe('{"ok":true}');
  });

  it("rejects oversized content-length", async () => {
    const req = mockReq([], "2048");
    await expect(
      readRequestBodyWithLimit(req, { maxBytes: 1024 }),
    ).rejects.toSatisfy((err) => isRequestBodyLimitError(err, "PAYLOAD_TOO_LARGE"));
  });

  it("rejects streaming overflow", async () => {
    const big = Buffer.alloc(2048, 1);
    await expect(
      readRequestBodyWithLimit(mockReq([big]), { maxBytes: 1024, timeoutMs: 2000 }),
    ).rejects.toBeInstanceOf(RequestBodyLimitError);
  });
});
