/**
 * Config sync factory unit tests.
 */
import { describe, expect, it } from "vitest";

import { createConfigSyncService } from "./config-sync.js";

describe("createConfigSyncService", () => {
  it("noop backend starts and stops cleanly", async () => {
    const svc = createConfigSyncService({ type: "none" });
    await expect(svc.start()).resolves.toBeUndefined();
    await expect(svc.stop()).resolves.toBeUndefined();
  });

  it("noop pushConfig is a no-op", async () => {
    const svc = createConfigSyncService({ type: "none" });
    await expect(svc.pushConfig({ cluster: { nodeId: "x" } })).resolves.toBeUndefined();
  });

  it("noop onConfigChange accepts callback without firing", () => {
    const svc = createConfigSyncService({ type: "none" });
    expect(() => svc.onConfigChange(() => {})).not.toThrow();
  });

  it("throws for unknown config sync type", () => {
    expect(() => createConfigSyncService({ type: "kafka" as "none" })).toThrow(
      /Unknown config sync type/,
    );
  });
});
