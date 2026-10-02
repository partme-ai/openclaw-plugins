import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createDeliveryJournal, DeliveryIdentityConflictError } from "./delivery-journal.js";

const dirs: string[] = [];
function open() {
  const dir = mkdtempSync(join(tmpdir(), "sdk-delivery-"));
  dirs.push(dir);
  return { dir, journal: createDeliveryJournal(dir) };
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("durable delivery journal", () => {
  it("blocks agent replay after send_started survives a restart", () => {
    const { dir, journal } = open();
    expect(journal.claim("rabbitmq", "default", "cid-1", "payload-a")).toBe("claimed");
    journal.markAgentStarted("rabbitmq", "default", "cid-1");
    journal.sendStarted("rabbitmq", "default", "cid-1", "wire-hash");
    journal.close();
    const restarted = createDeliveryJournal(dir);
    expect(restarted.claim("rabbitmq", "default", "cid-1", "payload-a")).toBe("pending");
    expect(restarted.inspect("rabbitmq", "default", "cid-1")).toMatchObject({ sendsStarted: 1, sendsConfirmed: 0 });
    restarted.close();
  });

  it("replays a complete settlement without rerunning the agent", () => {
    const { dir, journal } = open();
    journal.claim("rabbitmq", "default", "cid-2", "payload-a");
    journal.markAgentStarted("rabbitmq", "default", "cid-2");
    journal.sendStarted("rabbitmq", "default", "cid-2", "wire-hash");
    journal.sendConfirmed("rabbitmq", "default", "cid-2", "wire-hash");
    journal.settle("rabbitmq", "default", "cid-2", "delivered");
    journal.close();
    const restarted = createDeliveryJournal(dir);
    expect(restarted.claim("rabbitmq", "default", "cid-2", "payload-a")).toBe("delivered");
    restarted.close();
  });
  it("durably retains a prepared broker ACK outcome across restart and permits confirmation without rerunning Agent", () => {
    const { dir, journal } = open();
    journal.claim("rabbitmq", "default", "cid-prepared", "payload-a");
    journal.markAgentStarted("rabbitmq", "default", "cid-prepared");
    journal.sendStarted("rabbitmq", "default", "cid-prepared", "wire-hash");
    journal.sendConfirmed("rabbitmq", "default", "cid-prepared", "wire-hash");
    journal.prepareSettlement("rabbitmq", "default", "cid-prepared", "delivered");
    journal.close();
    const restarted = createDeliveryJournal(dir);
    expect(restarted.inspect("rabbitmq", "default", "cid-prepared")?.status).toBe("ack-pending-delivered");
    expect(restarted.listPreparedSettlements()).toEqual([
      expect.objectContaining({ channel: "rabbitmq", accountId: "default", inboundId: "cid-prepared", status: "ack-pending-delivered" }),
    ]);
    expect(restarted.claim("rabbitmq", "default", "cid-prepared", "payload-a")).toBe("ack-pending-delivered");
    restarted.confirmPreparedSettlement("rabbitmq", "default", "cid-prepared", "delivered");
    expect(restarted.claim("rabbitmq", "default", "cid-prepared", "payload-a")).toBe("delivered");
    expect(restarted.listPreparedSettlements()).toEqual([]);
    restarted.close();
  });

  it("retries only a run with no send attempt", () => {
    const { journal } = open();
    journal.claim("rabbitmq", "default", "cid-3", "payload-a");
    journal.releaseBeforeSend("rabbitmq", "default", "cid-3");
    expect(journal.claim("rabbitmq", "default", "cid-3", "payload-a")).toBe("claimed");
    journal.close();
  });
  it("rejects the same delivery identity with a different payload even after settlement", () => {
    const { journal } = open();
    journal.claim("rabbitmq", "default", "cid-conflict", "payload-a");
    journal.markAgentStarted("rabbitmq", "default", "cid-conflict");
    journal.settle("rabbitmq", "default", "cid-conflict", "no-reply");
    expect(() => journal.claim("rabbitmq", "default", "cid-conflict", "payload-b"))
      .toThrow(DeliveryIdentityConflictError);
    journal.close();
  });
  it("recovers an abandoned pre-Agent claim but never an Agent-started claim", () => {
    const { dir, journal } = open();
    journal.claim("rabbitmq", "default", "cid-pre", "payload-a");
    journal.claim("rabbitmq", "default", "cid-agent", "payload-b");
    journal.markAgentStarted("rabbitmq", "default", "cid-agent");
    journal.close();
    const db = new DatabaseSync(join(dir, "plugins", "message-sdk", "delivery-journal.sqlite"));
    db.prepare("UPDATE delivery SET owner_pid=999999999 WHERE inbound_id IN ('cid-pre','cid-agent')").run();
    db.close();
    const restarted = createDeliveryJournal(dir);
    expect(restarted.claim("rabbitmq", "default", "cid-pre", "payload-a")).toBe("claimed");
    expect(restarted.claim("rabbitmq", "default", "cid-agent", "payload-b")).toBe("pending");
    restarted.close();
  });
  it("keeps a live pre-Agent owner pending and never releases an Agent-started claim", () => {
    const { journal } = open();
    expect(journal.claim("rabbitmq", "default", "cid-live", "payload-a")).toBe("claimed");
    expect(journal.claim("rabbitmq", "default", "cid-live", "payload-a")).toBe("pending");
    journal.markAgentStarted("rabbitmq", "default", "cid-live");
    journal.releaseBeforeSend("rabbitmq", "default", "cid-live");
    expect(journal.claim("rabbitmq", "default", "cid-live", "payload-a")).toBe("pending");
    journal.close();
  });
  it("recovers a pre-Agent claim when the PID was reused by a new process", () => {
    const { dir, journal } = open();
    journal.claim("rabbitmq", "default", "cid-reused-pid", "payload-a");
    journal.close();
    const db = new DatabaseSync(join(dir, "plugins", "message-sdk", "delivery-journal.sqlite"));
    db.prepare("UPDATE delivery SET owner_start='previous-process' WHERE inbound_id='cid-reused-pid'").run();
    db.close();
    const restarted = createDeliveryJournal(dir);
    expect(restarted.claim("rabbitmq", "default", "cid-reused-pid", "payload-a")).toBe("claimed");
    restarted.close();
  });
  it("rejects a database symlink inside the private profile directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "sdk-delivery-"));
    dirs.push(dir);
    mkdirSync(join(dir, "plugins", "message-sdk"), { recursive: true });
    symlinkSync(join(dir, "outside.sqlite"), join(dir, "plugins", "message-sdk", "delivery-journal.sqlite"));
    expect(() => createDeliveryJournal(dir)).toThrow("not a regular file");
  });
});
