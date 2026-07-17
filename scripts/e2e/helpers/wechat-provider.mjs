/** 微信 iLink getUpdates/getConfig/sendMessage 的本地协议夹具，不使用真实账号或 Token。 */
import * as http from "node:http";

const ACCOUNT_ID = "e2e-im-bot";
const USER_ID = "wechat-e2e-user@im.wechat";
const TOKEN = "wechat-e2e-token";
const CONTEXT_TOKEN = "wechat-e2e-context-token";
const MESSAGE_ID = "wechat-e2e-message-1";

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export async function startWechatProvider(port) {
  const baseMessage = {
    seq: 1,
    message_id: MESSAGE_ID,
    from_user_id: USER_ID,
    to_user_id: ACCOUNT_ID,
    context_token: CONTEXT_TOKEN,
    text: "请回复微信 E2E 消息",
  };
  // 队列既能重放相同 message_id 验证持久去重，也能注入新 ID 验证 Bridge 的真实 Hook 链路。
  const deliveries = [baseMessage];
  const metrics = {
    getUpdates: 0,
    deliveredBatches: 0,
    getConfig: 0,
    replies: 0,
    lastReply: null,
    desiredDeliveries: deliveries.length,
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method !== "POST") return writeJson(response, 405, { ret: -1 });
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      return writeJson(response, 401, { ret: 401, errmsg: "invalid token" });
    }
    const body = await readJson(request);
    if (url.pathname === "/ilink/bot/getupdates") {
      metrics.getUpdates += 1;
      if (metrics.deliveredBatches < deliveries.length) {
        const delivery = deliveries[metrics.deliveredBatches];
        metrics.deliveredBatches += 1;
        return writeJson(response, 200, {
          ret: 0,
          msgs: [{
            seq: delivery.seq,
            message_id: delivery.message_id,
            from_user_id: delivery.from_user_id,
            to_user_id: delivery.to_user_id,
            create_time_ms: Date.now(),
            context_token: delivery.context_token,
            item_list: [{ type: 1, text_item: { text: delivery.text } }],
          }],
          get_updates_buf: `cursor-${metrics.deliveredBatches}`,
          longpolling_timeout_ms: 1_000,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      return writeJson(response, 200, {
        ret: 0,
        msgs: [],
        get_updates_buf: body.get_updates_buf || `cursor-${metrics.deliveredBatches}`,
        longpolling_timeout_ms: 1_000,
      });
    }
    if (url.pathname === "/ilink/bot/getconfig") {
      metrics.getConfig += 1;
      return writeJson(response, 200, { ret: 0 });
    }
    if (url.pathname === "/ilink/bot/sendmessage") {
      metrics.replies += 1;
      metrics.lastReply = { authorization: request.headers.authorization, body };
      return writeJson(response, 200, { ret: 0 });
    }
    return writeJson(response, 404, { ret: 404 });
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
      deliveries.push({ ...baseMessage });
      metrics.desiredDeliveries = deliveries.length;
    },
    enqueueMessage(messageId, text) {
      deliveries.push({ ...baseMessage, seq: deliveries.length + 1, message_id: messageId, text });
      metrics.desiredDeliveries = deliveries.length;
    },
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    }),
  };
}
