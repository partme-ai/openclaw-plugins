/**
 * STOMP TCP config resolver smoke tests (no Docker).
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_STOMP_TCP_CONFIG, resolveStompTcpConfig } from "../src/config.js";

describe("resolveStompTcpConfig", () => {
  it("applies defaults when channels.stomp-tcp is missing", () => {
    const cfg = resolveStompTcpConfig({});
    expect(cfg.port).toBe(DEFAULT_STOMP_TCP_CONFIG.port);
    expect(cfg.auth.required).toBe(true);
    expect(cfg.topicBindings).toEqual([]);
    expect(cfg.prefetchCount).toBe(100);
  });

  it("parses topicBindings and filters invalid rows", () => {
    const cfg = resolveStompTcpConfig({
      channels: {
        "stomp-tcp": {
          port: 61673,
          auth: { required: false },
          topicBindings: [
            { topicPattern: "devices/*/in", agentId: "a1", replyTopic: "/topic/out" },
            { topicPattern: "", agentId: "skip" },
            { topicPattern: "no-agent" },
          ],
        },
      },
    });
    expect(cfg.port).toBe(61673);
    expect(cfg.auth.required).toBe(false);
    expect(cfg.topicBindings).toHaveLength(1);
    expect(cfg.topicBindings[0]).toMatchObject({
      topicPattern: "devices/*/in",
      agentId: "a1",
      replyTopic: "/topic/out",
    });
  });

  it("merges heartbeat and tls settings", () => {
    const cfg = resolveStompTcpConfig({
      channels: {
        "stomp-tcp": {
          heartbeat: { serverMs: 5000, clientMs: 4000 },
          tls: { enabled: true, certFile: "/etc/cert.pem" },
        },
      },
    });
    expect(cfg.heartbeat.serverMs).toBe(5000);
    expect(cfg.heartbeat.clientMs).toBe(4000);
    expect(cfg.tls.enabled).toBe(true);
    expect(cfg.tls.certFile).toBe("/etc/cert.pem");
  });
});
