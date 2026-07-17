/** Web STOMP embedded gateway real Agent E2E adapter. */
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

async function connectStompWebSocket(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening Web-STOMP socket")), 15_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(undefined);
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Web-STOMP websocket error"));
    }, { once: true });
  });

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
  ws.addEventListener("message", (event) => {
    buffer += typeof event.data === "string" ? event.data : "";
    let end = buffer.indexOf("\0");
    while (end >= 0) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (raw.trim()) dispatch(parseFrame(raw));
      end = buffer.indexOf("\0");
    }
  });
  ws.addEventListener("close", () => {
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Web-STOMP socket closed before expected frame"));
    }
  });

  return {
    send: (command, headers, body) => ws.send(encodeFrame(command, headers, body)),
    waitForFrame(predicate, label, timeoutMs = 45_000) {
      const existing = frames.findIndex(predicate);
      if (existing >= 0) return Promise.resolve(frames.splice(existing, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject, timer: undefined };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for Web-STOMP ${label}`));
        }, timeoutMs);
        waiter.timer.unref?.();
        waiters.push(waiter);
      });
    },
    close: () => ws.close(),
  };
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testWebStomp(ctx, results) {
  await runAdapterTest(
    ctx,
    "web-stomp",
    async () => {
      if (!ctx.modelFixture) throw new Error("Web-STOMP Agent E2E requires the local model fixture");
      const status = await ctx.gatewayFetch("/stomp/status");
      if (!status.ok) throw new Error(`/stomp/status → ${status.status}`);
      const port = ctx.ports.webStompWs;
      await ctx.waitFor(() => ctx.tcpReachable(port), { label: `web-stomp ws ${port}`, timeoutMs: 30_000 });

      const client = await connectStompWebSocket(`ws://127.0.0.1:${port}/ws`);
      try {
        const connectedPromise = client.waitForFrame((frame) => frame.command === "CONNECTED", "CONNECTED");
        client.send("CONNECT", {
          "accept-version": "1.2",
          host: "localhost",
          "heart-beat": "0,0",
          login: "web-stomp-e2e",
          passcode: "web-stomp-e2e-secret",
        });
        const connected = await connectedPromise;
        const sessionId = connected.headers.session;
        if (!sessionId) throw new Error("Web-STOMP CONNECTED frame did not include a session id");
        const replyDestination = `/topic/session.stomp:${sessionId}@main`;

        const subscribed = client.waitForFrame(
          (frame) => frame.command === "RECEIPT" && frame.headers["receipt-id"] === "subscribe-ready",
          "SUBSCRIBE receipt",
        );
        client.send("SUBSCRIBE", {
          id: "agent-reply",
          destination: replyDestination,
          ack: "client-individual",
          receipt: "subscribe-ready",
        });
        await subscribed;

        const beforeCompletions = ctx.modelFixture.metrics.completions;
        const replyPromise = client.waitForFrame(
          (frame) => frame.command === "MESSAGE" && frame.headers.destination === replyDestination,
          "Agent MESSAGE",
        );
        const sendReceipt = client.waitForFrame(
          (frame) => frame.command === "RECEIPT" && frame.headers["receipt-id"] === "agent-turn-complete",
          "SEND receipt",
        );
        client.send("SEND", {
          destination: "/queue/agent.main",
          "content-type": "application/json",
          "message-id": `web-stomp-e2e-${Date.now()}`,
          receipt: "agent-turn-complete",
        }, JSON.stringify({ ...ctx.pingPayload, text: "Return the Web-STOMP E2E fixture response." }));

        const [message] = await Promise.all([replyPromise, sendReceipt]);
        const envelope = JSON.parse(message.body);
        if (envelope?.message?.text !== "openclaw e2e fixture reply") {
          throw new Error(`Unexpected Web-STOMP reply envelope: ${message.body}`);
        }
        if (envelope?.message?.source?.channel !== "stomp") {
          throw new Error(`Web-STOMP reply source channel missing: ${message.body}`);
        }
        if (envelope?.headers?.replyRoute?.destination !== replyDestination) {
          throw new Error(`Web-STOMP reply route missing: ${message.body}`);
        }
        if (!message.headers.ack) throw new Error("Web-STOMP MESSAGE did not include an ACK id");

        const ackReceipt = client.waitForFrame(
          (frame) => frame.command === "RECEIPT" && frame.headers["receipt-id"] === "reply-acked",
          "ACK receipt",
        );
        client.send("ACK", { id: message.headers.ack, receipt: "reply-acked" });
        await ackReceipt;

        const completionDelta = ctx.modelFixture.metrics.completions - beforeCompletions;
        if (completionDelta !== 1) {
          throw new Error(`Web-STOMP model completion count mismatch: expected 1, got ${completionDelta}`);
        }
      } finally {
        client.close();
      }
    },
    {
      service: `embedded:${ctx.ports.webStompWs}/ws`,
      method: "CONNECT → SUBSCRIBE → SEND → real Agent Turn → MESSAGE → ACK/RECEIPT",
    },
    results,
  );
}
