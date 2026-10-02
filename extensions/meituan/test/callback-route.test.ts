import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveMeituanConfig } from "../src/config.js";
import { MeituanCallbackInbox } from "../src/callback/inbox.js";
import { createMeituanCallbackHandler } from "../src/callback/route.js";
import { createMeituanCallbackTool } from "../src/callback/tool.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

function signed(fields: Record<string, string>): string {
  const source = "secret" + Object.keys(fields).sort().map((key) => key + fields[key]).join("");
  return new URLSearchParams({ ...fields, sign: createHash("sha1").update(source).digest("hex") }).toString();
}

async function setup(maxInboxEntries = 10) {
  const dir = await mkdtemp(join(tmpdir(), "meituan-route-test-"));
  const config = resolveMeituanConfig({ enabled: true, developerId: "123", signKey: "secret", callbacks: {
    enabled: true, inboxDirectory: dir, maxInboxEntries,
  } })!;
  const inbox = new MeituanCallbackInbox(dir, maxInboxEntries);
  const handler = createMeituanCallbackHandler(config, inbox);
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test port");
  return { inbox, url: `http://127.0.0.1:${address.port}/meituan/callback` };
}

function body(msgId = "m1", msgType = "5810055") {
  return signed({ businessId: "58", msgType, msgId, developerId: "123",
    timestamp: String(Math.floor(Date.now() / 1000)), message: JSON.stringify({ orderId: "o1" }) });
}

describe("Meituan callback HTTP route", () => {
  it("ACKs only after durable storage and deduplicates repeated POST", async () => {
    const { inbox, url } = await setup();
    for (let i = 0; i < 2; i++) {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body() });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ code: 0, message: "success" });
    }
    expect(await inbox.list()).toHaveLength(1);
    const eventId = (await inbox.list())[0]!.eventId;
    const owner = createMeituanCallbackTool({ senderIsOwner: true, assertInvocationCurrent: () => {} } as never, inbox);
    const stranger = createMeituanCallbackTool({ senderIsOwner: false, assertInvocationCurrent: () => {} } as never, inbox);
    expect((await owner.execute("x", { action: "list" })).content[0]!.text).not.toContain("orderId");
    expect((await stranger.execute("x", { action: "get", eventId })).content[0]!.text).not.toContain("orderId");
    expect((await owner.execute("x", { action: "get", eventId })).content[0]!.text).toContain("orderId");
    const bounded = createMeituanCallbackTool({ senderIsOwner: true, assertInvocationCurrent: () => {} } as never, inbox, 64);
    expect((await bounded.execute("x", { action: "get", eventId })).content[0]!.text).not.toContain("orderId");
    const revoked = createMeituanCallbackTool({ senderIsOwner: true, assertInvocationCurrent: () => { throw new Error("revoked"); } } as never, inbox);
    expect((await revoked.execute("x", { action: "ack", eventId })).content[0]!.text).toContain("false");
    expect(await inbox.list()).toHaveLength(1);
    await owner.execute("x", { action: "ack", eventId });
    expect(await inbox.list()).toHaveLength(0);
  });

  it("rejects bad signature, command type, invalid method and full storage", async () => {
    const { inbox, url } = await setup(1);
    const post = (value: string) => fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: value });
    expect((await fetch(url)).status).toBe(405);
    expect((await post(body().replace(/sign=[a-f0-9]{40}/, `sign=${"0".repeat(40)}`))).status).toBe(401);
    expect((await post(body("m1", "5810149"))).status).toBe(422);
    expect(await inbox.list()).toHaveLength(0);
    expect((await post(body("m1"))).status).toBe(200);
    expect((await post(body("m2"))).status).toBe(503);
    expect(await inbox.list()).toHaveLength(1);
  });

  it("ACKs and persists a long numeric order ID without precision loss", async () => {
    const { inbox, url } = await setup();
    const message = '{"orderId":3702923312382104528}';
    const value = signed({ businessId: "58", msgType: "5810055", msgId: "large-id",
      developerId: "123", timestamp: String(Math.floor(Date.now() / 1000)), message });
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: value });
    expect(response.status).toBe(200);
    const saved = (await inbox.list())[0]!;
    expect(saved.payload.orderId).toBe("3702923312382104528");
    expect(saved.messageRaw).toBe(message);
  });
});
