import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
} from "../runtime/runtime-api.js";

function mockReq(chunks: Buffer[]): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & { destroy?: () => void };
  req.headers = {};
  req.destroy = () => req.removeAllListeners();
  setImmediate(() => {
    for (const c of chunks) req.emit("data", c);
    req.emit("end");
  });
  return req;
}

describe("webhook handler body limit integration", () => {
  it("reads JSON webhook payload within 1MB", async () => {
    const body = await readRequestBodyWithLimit(mockReq([Buffer.from('{"encrypt":"x"}')]), {
      maxBytes: 1024 * 1024,
    });
    expect(body).toContain("encrypt");
  });

  it("rejects oversized webhook body", async () => {
    await expect(
      readRequestBodyWithLimit(mockReq([Buffer.alloc(2048, 1)]), { maxBytes: 1024 }),
    ).rejects.toSatisfy((err: unknown) => isRequestBodyLimitError(err));
  });
});
