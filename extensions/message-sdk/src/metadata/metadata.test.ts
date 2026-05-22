/**
 * metadata.test.ts — 统一消息 metadata/extras 的读写、合并与路由字段解析。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, expect, it } from "vitest";

import {
  isOutboundEcho,
  markOutboundMetadata,
  mergeMetadata,
  readMetadata,
  resolveMetadataCorrelationId,
  resolveMetadataPeerId,
  resolveMetadataReplyRoute,
  resolveMetadataTraceId,
} from "./index.js";

describe("message metadata", () => {
  it("merges metadata without dropping channel-native extras", () => {
    const extras = mergeMetadata(
      {
        "client::display": { contentType: "text/markdown" },
        openclaw: { traceId: "trace-1" },
      },
      {
        peerId: "customer-1",
        correlationId: "corr-1",
      },
    );

    expect(extras).toMatchObject({
      "client::display": { contentType: "text/markdown" },
      openclaw: {
        traceId: "trace-1",
        peerId: "customer-1",
        correlationId: "corr-1",
      },
    });
  });

  it("marks and detects outbound echoes", () => {
    const extras = markOutboundMetadata({
      openclaw: { traceId: "trace-1" },
    });

    expect(readMetadata(extras)).toMatchObject({
      source: "openclaw",
      outbound: true,
      traceId: "trace-1",
    });
    expect(isOutboundEcho({ extras })).toBe(true);
    expect(isOutboundEcho({ extras: { openclaw: { outbound: true } } })).toBe(false);
  });

  it("resolves routing fields from the shared namespace", () => {
    const carrier = {
      extras: {
        openclaw: {
          peerId: " customer-1 ",
          correlationId: " corr-1 ",
          traceId: " trace-1 ",
          replyRoute: {
            topic: " replies ",
            routingKey: "",
            nested: { ignored: true },
          },
        },
      },
    };

    expect(resolveMetadataPeerId(carrier)).toBe("customer-1");
    expect(resolveMetadataCorrelationId(carrier)).toBe("corr-1");
    expect(resolveMetadataTraceId(carrier)).toBe("trace-1");
    expect(resolveMetadataReplyRoute(carrier)).toEqual({ topic: "replies" });
  });
});
