/** STOMP TCP embedded broker real Agent E2E adapter. */
import net from "node:net";
import { runAdapterTest } from "./_context.mjs";

function encodeFrame(command, headers = {}, body = "") {
  const lines = [command, ...Object.entries(headers).map(([key, value]) => `${key}:${value}`)];
  return `${lines.join("\n")}\n\n${body}\0`;
}

function unescapeHeader(value) {
  return value.replace(/\\([cnr\\])/g, (_match, code) => ({
    c: ":",
    n: "\n",
    r: "\r",
    "\\": "\\",
  })[code]);
}

function parseFrame(raw) {
  const normalized = raw.replace(/^\r?\n+/, "");
  const separator = normalized.search(/\r?\n\r?\n/);
  const head = separator >= 0 ? normalized.slice(0, separator) : normalized;
  const body = separator >= 0 ? normalized.slice(separator).replace(/^\r?\n\r?\n/, "") : "";
  const [command = "", ...headerLines] = head.split(/\r?\n/);
  const headers = Object.fromEntries(headerLines.filter(Boolean).map((line) => {
    const colon = line.indexOf(":");
    return colon < 0
      ? [line, ""]
      : [line.slice(0, colon), unescapeHeader(line.slice(colon + 1))];
  }));
  return { command, headers, body };
}

async function connectStomp(host, port) {
  const socket = await new Promise((resolve, reject) => {
    const candidate = net.connect({ host, port }, () => resolve(candidate));
    candidate.once("error", reject);
  });
  socket.setTimeout(45_000);
  let buffer = "";
  const frames = [];
  const waiters = [];

  function dispatch(frame) {
    const index = waiters.findIndex((waiter) => waiter.predicate(frame));
    if (index < 0) {
      frames.push(frame);
      return;
    }
    const [waiter] = waiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(frame);
  }

  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    let end = buffer.indexOf("\0");
    while (end >= 0) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (raw.trim()) dispatch(parseFrame(raw));
      end = buffer.indexOf("\0");
    }
  });

  function waitForFrame(predicate, label, timeoutMs = 45_000) {
    const existing = frames.findIndex(predicate);
    if (existing >= 0) return Promise.resolve(frames.splice(existing, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: undefined };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for STOMP ${label}`));
      }, timeoutMs);
      waiter.timer.unref?.();
      waiters.push(waiter);
    });
  }

  socket.on("error", (error) => {
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  });
  socket.on("timeout", () => socket.destroy(new Error("STOMP socket timeout")));

  return {
    send: (command, headers, body) => socket.write(encodeFrame(command, headers, body)),
    waitForFrame,
    close: () => socket.destroy(),
  };
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testStomp(ctx, results) {
  await runAdapterTest(
    ctx,
    "stomp",
    async () => {
      if (!ctx.modelFixture) throw new Error("STOMP Agent E2E requires the local model fixture");
      await ctx.waitFor(() => ctx.tcpReachable(ctx.ports.stompTcp), {
        label: `stomp-tcp ${ctx.ports.stompTcp}`,
        timeoutMs: 30_000,
      });

      const client = await connectStomp("127.0.0.1", ctx.ports.stompTcp);
      try {
        const connectedPromise = client.waitForFrame((frame) => frame.command === "CONNECTED", "CONNECTED");
        client.send("CONNECT", { "accept-version": "1.2", host: "localhost", "heart-beat": "0,0" });
        const connected = await connectedPromise;
        const sessionId = connected.headers.session;
        if (!sessionId) throw new Error("STOMP CONNECTED frame did not include a session id");
        const replyDestination = `/topic/session.stomp-tcp:${sessionId}@main`;

        const subscribed = client.waitForFrame(
          (frame) => frame.command === "RECEIPT" && frame.headers["receipt-id"] === "subscribe-ready",
          "SUBSCRIBE receipt",
        );
        client.send("SUBSCRIBE", {
          id: "agent-reply",
          destination: replyDestination,
          ack: "client-individual",
          "prefetch-count": "1",
          receipt: "subscribe-ready",
        });
        await subscribed;

        const beforeCompletions = ctx.modelFixture.metrics.completions;
        const messageId = `stomp-e2e-${Date.now()}`;
        const replyPromise = client.waitForFrame(
          (frame) => frame.command === "MESSAGE" && frame.headers.destination === replyDestination,
          "Agent MESSAGE",
        );
        const sendReceipt = client.waitForFrame(
          (frame) => frame.command === "RECEIPT" && frame.headers["receipt-id"] === "agent-turn-complete",
          "SEND receipt",
        );
        client.send("SEND", {
          destination: "/queue/agent.main.in",
          "content-type": "application/json",
          "message-id": messageId,
          receipt: "agent-turn-complete",
        }, JSON.stringify({ ...ctx.pingPayload, text: "Return the STOMP E2E fixture response." }));

        const [message] = await Promise.all([replyPromise, sendReceipt]);
        const envelope = JSON.parse(message.body);
        if (envelope?.message?.text !== "openclaw e2e fixture reply") {
          throw new Error(`Unexpected STOMP reply envelope: ${message.body}`);
        }
        if (envelope?.message?.source?.channel !== "stomp-tcp") {
          throw new Error(`STOMP reply source channel missing: ${message.body}`);
        }
        if (envelope?.headers?.replyRoute?.destination !== replyDestination) {
          throw new Error(`STOMP reply route missing: ${message.body}`);
        }
        if (!message.headers.ack) throw new Error("STOMP MESSAGE did not include an ACK id");

        const ackReceipt = client.waitForFrame(
          (frame) => frame.command === "RECEIPT" && frame.headers["receipt-id"] === "reply-acked",
          "ACK receipt",
        );
        client.send("ACK", { id: message.headers.ack, receipt: "reply-acked" });
        await ackReceipt;

        let status;
        await ctx.waitFor(async () => {
          status = await ctx.gatewayFetch("/stomp-tcp/status");
          const snapshot = status.json?.data?.snapshot;
          return status.ok
            && snapshot?.routedInbound > 0
            && snapshot?.routedOutbound > 0
            && snapshot?.ackPending === 0;
        }, { label: "STOMP ACK and transport statistics", timeoutMs: 10_000 });

        const completionDelta = ctx.modelFixture.metrics.completions - beforeCompletions;
        if (completionDelta !== 1) {
          throw new Error(`STOMP model completion count mismatch: expected 1, got ${completionDelta}`);
        }
      } finally {
        client.close();
      }
    },
    {
      service: `embedded:${ctx.ports.stompTcp}`,
      method: "CONNECT → SUBSCRIBE → SEND → real Agent Turn → MESSAGE → ACK/RECEIPT",
    },
    results,
  );
}
