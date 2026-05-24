/**
 * Rednode (xhs) resolver tests.
 */
import { describe, expect, it } from "vitest";

import {
  resolveXhsAgentReplyTimeoutMs,
  resolveXhsEgressProxyUrl,
  resolveXhsMediaMaxBytes,
} from "../src/config/resolvers.js";

describe("xhs config resolvers", () => {
  it("uses 20MB default media max bytes", () => {
    expect(resolveXhsMediaMaxBytes({ channels: {} })).toBe(20 * 1024 * 1024);
  });

  it("honours channels.xhs.media.maxBytes override", () => {
    expect(resolveXhsMediaMaxBytes({ channels: { xhs: { media: { maxBytes: 4096 } } } })).toBe(
      4096,
    );
  });

  it("uses 10 minute default agent reply timeout", () => {
    expect(resolveXhsAgentReplyTimeoutMs({ channels: {} })).toBe(10 * 60 * 1000);
  });

  it("reads channels.xhs.network.egressProxyUrl", () => {
    expect(
      resolveXhsEgressProxyUrl({
        channels: { xhs: { network: { egressProxyUrl: "http://127.0.0.1:8888" } } },
      }),
    ).toBe("http://127.0.0.1:8888");
  });
});
