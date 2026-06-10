/**
 * Discovery factory unit tests.
 */
import { describe, expect, it } from "vitest";

import { createDiscoveryService } from "./discovery.js";
import { StaticDiscovery } from "./static-discovery.js";

describe("createDiscoveryService", () => {
  it("returns StaticDiscovery for static type", () => {
    const svc = createDiscoveryService(
      { type: "static", staticNodes: ["10.0.0.1:18789"] },
      "node-a",
    );
    expect(svc).toBeInstanceOf(StaticDiscovery);
  });

  it("passes staticNodes to StaticDiscovery", async () => {
    const svc = createDiscoveryService(
      { type: "static", staticNodes: ["127.0.0.1:18789"] },
      "node-a",
    );
    await svc.start();
    expect(svc.getNodes()).toHaveLength(1);
    await svc.stop();
  });

  it("throws for unknown discovery type", () => {
    expect(() =>
      createDiscoveryService({ type: "unknown" as "static" }, "node-a"),
    ).toThrow(/Unknown discovery type/);
  });
});
