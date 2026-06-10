/**
 * Session store factory unit tests.
 */
import { describe, expect, it } from "vitest";

import { createSessionStoreService } from "./session-store.js";

describe("createSessionStoreService (memory)", () => {
  it("registers and resolves session node", async () => {
    const store = createSessionStoreService({ type: "memory", sessionTtl: 3600 }, "node-1");
    await store.start();
    await store.registerSession("sess-1");
    expect(await store.getSessionNode("sess-1")).toBe("local");
    await store.stop();
  });

  it("returns null for unknown session", async () => {
    const store = createSessionStoreService({ type: "memory", sessionTtl: 3600 });
    await store.start();
    expect(await store.getSessionNode("missing")).toBeNull();
    await store.stop();
  });

  it("removeSession clears mapping", async () => {
    const store = createSessionStoreService({ type: "memory", sessionTtl: 3600 });
    await store.start();
    await store.registerSession("sess-rm");
    await store.removeSession("sess-rm");
    expect(await store.getSessionNode("sess-rm")).toBeNull();
    await store.stop();
  });

  it("stop clears all sessions", async () => {
    const store = createSessionStoreService({ type: "memory", sessionTtl: 3600 });
    await store.start();
    await store.registerSession("sess-a");
    await store.stop();
    await store.start();
    expect(await store.getSessionNode("sess-a")).toBeNull();
    await store.stop();
  });

  it("throws for unknown session store type", () => {
    expect(() =>
      createSessionStoreService({ type: "cassandra" as "memory", sessionTtl: 1 }),
    ).toThrow(/Unknown session store type/);
  });
});
