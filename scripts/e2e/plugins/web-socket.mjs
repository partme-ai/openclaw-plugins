import WebSocket from "ws";
import { runAdapterTest } from "./_context.mjs";

const TOKEN = "openclaw-web-socket-e2e-token";
const ORIGIN = "https://e2e.openclaw.local";

function rejectedStatus(url, options) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.once("open", () => {
      socket.close();
      reject(new Error("WebSocket connection unexpectedly succeeded"));
    });
    socket.once("error", reject);
  });
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN },
    });
    let opened = false;
    let connectedFrame;
    const finish = () => {
      if (opened && connectedFrame) resolve({ socket, connectedFrame });
    };
    socket.once("open", () => {
      opened = true;
      finish();
    });
    socket.on("message", function onInitialMessage(data) {
      try {
        const value = JSON.parse(data.toString("utf8"));
        if (value?.type !== "connected") return;
        connectedFrame = value;
        socket.off("message", onInitialMessage);
        finish();
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

function openBrowserStyleSocket(url) {
  const encoded = Buffer.from(TOKEN, "utf8").toString("base64url");
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, ["openclaw.v1", `openclaw.auth.${encoded}`], {
      headers: { Origin: ORIGIN },
    });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextJson(socket, expectedType) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedType} frame`)), 5_000);
    socket.on("message", function onMessage(data) {
      let value;
      try {
        value = JSON.parse(data.toString("utf8"));
      } catch (error) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        reject(error);
        return;
      }
      if (value?.type !== expectedType) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(value);
    });
  });
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testWebSocket(ctx, results) {
  await runAdapterTest(
    ctx,
    "web-socket",
    async () => {
      const url = `ws://127.0.0.1:${ctx.ports.webSocket}/openclaw/ws`;
      await ctx.waitFor(() => ctx.tcpReachable(ctx.ports.webSocket), {
        label: "web-socket listener",
        timeoutMs: 30_000,
      });

      const anonymous = await rejectedStatus(url);
      if (anonymous !== 401) throw new Error(`anonymous upgrade → ${anonymous}, expected 401`);
      const queryToken = await rejectedStatus(`${url}?token=${encodeURIComponent(TOKEN)}`);
      if (queryToken !== 401) throw new Error(`query token upgrade → ${queryToken}, expected 401`);
      const badOrigin = await rejectedStatus(url, {
        headers: { Authorization: `Bearer ${TOKEN}`, Origin: "https://evil.example" },
      });
      if (badOrigin !== 403) throw new Error(`disallowed Origin → ${badOrigin}, expected 403`);

      const { socket, connectedFrame: connected } = await openSocket(url);
      try {
        if (!ctx.modelFixture) throw new Error("WebSocket Agent E2E requires the local model fixture");
        if (connected.version !== "1") throw new Error(`unexpected protocol version: ${connected.version}`);
        if (typeof connected.connectionId !== "string" || connected.connectionId.length < 10) {
          throw new Error("connected frame did not include a valid connectionId");
        }

        const pongPromise = nextJson(socket, "pong");
        socket.send(JSON.stringify({ type: "ping" }));
        await pongPromise;

        const errorPromise = nextJson(socket, "error");
        socket.send(JSON.stringify({ type: "unsupported" }));
        const errorFrame = await errorPromise;
        if (errorFrame.message !== "Invalid message frame") {
          throw new Error(`unexpected invalid-frame response: ${JSON.stringify(errorFrame)}`);
        }

        const status = await ctx.gatewayFetch("/web-socket/status");
        if (!status.ok || status.json?.data?.server?.connectionCount !== 1) {
          throw new Error(`status did not report active connection: ${status.status} ${status.text}`);
        }
        if (status.json?.data?.config?.server?.auth?.token || status.json?.data?.config?.server?.auth?.tokens) {
          throw new Error("status response leaked WebSocket authentication material");
        }
        const postStatus = await ctx.gatewayFetch("/web-socket/status", { method: "POST" });
        if (postStatus.status !== 405) throw new Error(`POST status → ${postStatus.status}, expected 405`);

        const beforeCompletions = ctx.modelFixture.metrics.completions;
        const messageId = `web-socket-e2e-${Date.now()}`;
        const replyPromise = nextJson(socket, "reply");
        const acceptedPromise = nextJson(socket, "accepted");
        socket.send(JSON.stringify({
          version: "1",
          type: "message",
          messageId,
          peerId: "web-socket-e2e-user",
          text: "Return the WebSocket E2E fixture response.",
        }));
        const [reply, accepted] = await Promise.all([replyPromise, acceptedPromise]);
        const replyText = reply?.message?.text ?? reply?.text;
        if (replyText !== "openclaw e2e fixture reply") {
          throw new Error(`unexpected Agent reply: ${JSON.stringify(reply)}`);
        }
        if (accepted.messageId !== messageId) {
          throw new Error(`accepted frame did not correlate messageId: ${JSON.stringify(accepted)}`);
        }
        const completionDelta = ctx.modelFixture.metrics.completions - beforeCompletions;
        if (completionDelta !== 1) throw new Error(`model completion count mismatch: expected 1, got ${completionDelta}`);

        const browserStyle = await openBrowserStyleSocket(url);
        if (browserStyle.protocol !== "openclaw.v1") {
          browserStyle.close();
          throw new Error(`browser subprotocol negotiation failed: ${browserStyle.protocol}`);
        }
        browserStyle.close();
      } finally {
        socket.close(1000, "E2E complete");
      }
    },
    {
      service: `ws://127.0.0.1:${ctx.ports.webSocket}/openclaw/ws`,
      method: "Bearer/browser auth → versioned message → real Agent Turn → reply → accepted",
    },
    results,
  );
}
