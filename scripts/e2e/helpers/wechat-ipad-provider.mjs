/**
 * 微信 iPad 外部桥接的本地双通道夹具。
 *
 * WebSocket 模拟协议服务推送，HTTP 模拟 `/api/send` 与 `/api/status`；只验证公开桥接契约，
 * 不实现、不连接任何微信非官方协议，也不需要真实账号或 Token。
 */
import * as http from "node:http";
import { WebSocketServer } from "ws";

const TOKEN = "wechat-ipad-e2e-token";
const MESSAGE_ID = "wechat-ipad-e2e-message-1";

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

/** 启动同端口 HTTP + WebSocket 服务，并暴露可断言的最小指标。 */
export async function startWechatIpadProvider(port) {
  const metrics = {
    connections: 0,
    deliveredEvents: 0,
    desiredDeliveries: 1,
    replies: 0,
    lastReply: null,
  };
  const server = http.createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      return writeJson(response, 401, { ok: false, error: "invalid token" });
    }
    if (request.method === "GET" && request.url === "/api/status") {
      return writeJson(response, 200, { ok: true, data: { status: "logged_in" } });
    }
    if (request.method === "POST" && request.url === "/api/send") {
      const body = await readJson(request);
      metrics.replies += 1;
      metrics.lastReply = { authorization: request.headers.authorization, body };
      return writeJson(response, 200, { ok: true, data: { msgId: `reply-${metrics.replies}` } });
    }
    return writeJson(response, 404, { ok: false, error: "not found" });
  });
  const webSocketServer = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit("connection", client, request);
    });
  });
  webSocketServer.on("connection", (client) => {
    metrics.connections += 1;
    client.send(JSON.stringify({
      type: "login_status",
      timestamp: Date.now(),
      data: { status: "logged_in", wxid: "wxid_e2e_bot" },
    }));
    if (metrics.deliveredEvents >= metrics.desiredDeliveries) return;
    metrics.deliveredEvents += 1;
    client.send(JSON.stringify({
      type: "message",
      timestamp: Date.now(),
      data: {
        msgId: MESSAGE_ID,
        fromWxid: "wxid_e2e_user",
        toWxid: "wxid_e2e_bot",
        msgType: 1,
        content: "请回复微信 iPad E2E 消息",
        createTime: Math.floor(Date.now() / 1000),
        isGroup: false,
        isSelf: false,
      },
    }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    metrics,
    replayMessage() {
      metrics.desiredDeliveries += 1;
    },
    close: () => new Promise((resolve, reject) => {
      for (const client of webSocketServer.clients) client.terminate();
      webSocketServer.close(() => server.close((error) => (error ? reject(error) : resolve())));
      server.closeAllConnections();
    }),
  };
}
