import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchInboundStomp } from "../src/inbound.js";
import { setWebStompRuntime } from "../src/runtime.js";

let stateDir: string;
let previousStateDir: string | undefined;
let agentRuns: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "web-stomp-redelivery-"));
  previousStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = stateDir;
  agentRuns = vi.fn(async () => ({ deliberateSilentTerminalReply: true }));
  setWebStompRuntime({
    config: {},
    channel: {
      routing: { resolveAgentRoute: vi.fn(async ({ peer }: { peer: { id: string } }) => ({
        agentId: "main", sessionKey: `agent:main:${peer.id}`,
      })) },
      reply: {
        finalizeInboundContext: vi.fn(async (ctx: unknown) => ctx),
        createReplyDispatcherWithTyping: vi.fn(() => ({ dispatcher: { waitForIdle: vi.fn(async () => ({
          counts: Object.fromEntries(["tool", "block", "final"].map((kind) => [kind, {
            delivered: 0, deliveredNotVisible: 0, cancelled: 0, failedBeforeSend: 0, failedAfterSend: 0,
          }])),
          anyVisibleDelivered: false,
        })) }, replyOptions: {} })),
        dispatchReplyFromConfig: agentRuns,
      },
    },
  } as never);
});

afterEach(() => {
  setWebStompRuntime(null as never);
  if (previousStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = previousStateDir;
  rmSync(stateDir, { recursive: true, force: true });
});

describe("Web STOMP durable redelivery through real message-sdk journal", () => {
  const base = {
    destination: "/queue/agent.main", senderScope: "auth:alice",
    idempotencyKey: "app-42", rawPayload: "hello",
  };

  it("settles one Agent turn across a sender reconnect with a new peer ID", async () => {
    await dispatchInboundStomp({ ...base, peerId: "stomp:conn-1@main" });
    await dispatchInboundStomp({ ...base, peerId: "stomp:conn-2@main" });
    expect(agentRuns).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed business body under the same sender and application ID", async () => {
    await dispatchInboundStomp({ ...base, peerId: "stomp:conn-1@main" });
    await expect(dispatchInboundStomp({ ...base, peerId: "stomp:conn-2@main", rawPayload: "changed" }))
      .rejects.toThrow(/Delivery identity conflict/);
    expect(agentRuns).toHaveBeenCalledTimes(1);
  });

  it("isolates two authenticated senders using the same application ID", async () => {
    await dispatchInboundStomp({ ...base, peerId: "stomp:alice@main" });
    await dispatchInboundStomp({ ...base, senderScope: "auth:bob", peerId: "stomp:bob@main" });
    expect(agentRuns).toHaveBeenCalledTimes(2);
  });
});
