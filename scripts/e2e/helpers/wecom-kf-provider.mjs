/**
 * 企业微信客服安装态 E2E 的本地协议夹具。
 *
 * 一台 HTTP 服务同时模拟 `gettoken`、`kf/sync_msg`、`kf/send_msg` 三个公开 API；
 * `triggerCallback()` 则按企业微信 AES-CBC + SHA-1 规则向 Gateway 发送真实加密回调。
 * 夹具只验证标准协议边界，不连接企业微信网络，也不使用任何真实企业凭据。
 */
import * as crypto from "node:crypto";
import * as http from "node:http";

export const WECOM_KF_E2E = {
  token: "wecom-kf-e2e-token",
  encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
  corpId: "ww_e2e_corp",
  corpSecret: "wecom-kf-e2e-secret",
  openKfId: "wk_e2e_account",
  externalUserId: "wm_e2e_customer",
  messageId: "wecom-kf-e2e-message-1",
  accessToken: "wecom-kf-e2e-access-token",
};

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

/** 企业微信使用 32 字节块的 PKCS#7，而不是 OpenSSL 默认的 AES 16 字节块填充。 */
function pkcs7Pad(input) {
  const padding = 32 - (input.length % 32 || 32) || 32;
  return Buffer.concat([input, Buffer.alloc(padding, padding)]);
}

function encryptCallbackXml(plaintext) {
  const aesKey = Buffer.from(`${WECOM_KF_E2E.encodingAESKey}=`, "base64");
  const message = Buffer.from(plaintext, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(message.length, 0);
  const raw = Buffer.concat([
    crypto.randomBytes(16),
    length,
    message,
    Buffer.from(WECOM_KF_E2E.corpId, "utf8"),
  ]);
  const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, aesKey.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(pkcs7Pad(raw)), cipher.final()]).toString("base64");
}

function signCallback(timestamp, nonce, encrypted) {
  return crypto.createHash("sha1").update(
    [WECOM_KF_E2E.token, timestamp, nonce, encrypted].sort().join(""),
  ).digest("hex");
}

/** 启动本地 WeCom OpenAPI 夹具，并暴露收发指标与加密回调触发器。 */
export async function startWecomKfProvider(port) {
  const metrics = {
    tokenRequests: 0,
    syncRequests: [],
    callbacks: 0,
    replies: 0,
    lastReply: null,
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/cgi-bin/gettoken") {
      metrics.tokenRequests += 1;
      if (
        url.searchParams.get("corpid") !== WECOM_KF_E2E.corpId ||
        url.searchParams.get("corpsecret") !== WECOM_KF_E2E.corpSecret
      ) {
        return writeJson(response, 200, { errcode: 40013, errmsg: "invalid corpid" });
      }
      return writeJson(response, 200, {
        errcode: 0,
        errmsg: "ok",
        access_token: WECOM_KF_E2E.accessToken,
        expires_in: 7200,
      });
    }
    if (url.searchParams.get("access_token") !== WECOM_KF_E2E.accessToken) {
      return writeJson(response, 200, { errcode: 40014, errmsg: "invalid access token" });
    }
    if (request.method === "POST" && url.pathname === "/cgi-bin/kf/sync_msg") {
      const body = await readJson(request);
      metrics.syncRequests.push(body);
      return writeJson(response, 200, {
        errcode: 0,
        errmsg: "ok",
        next_cursor: "wecom-kf-e2e-cursor-1",
        has_more: 0,
        // 每次回放同一个 msgid：第二次 Gateway 启动后必须由持久化去重层拦截。
        msg_list: [{
          msgid: WECOM_KF_E2E.messageId,
          open_kfid: WECOM_KF_E2E.openKfId,
          external_userid: WECOM_KF_E2E.externalUserId,
          send_time: Math.floor(Date.now() / 1000),
          origin: 3,
          msgtype: "text",
          text: { content: "请回复企业微信客服 E2E 消息" },
        }],
      });
    }
    if (request.method === "POST" && url.pathname === "/cgi-bin/kf/send_msg") {
      const body = await readJson(request);
      metrics.replies += 1;
      metrics.lastReply = body;
      return writeJson(response, 200, { errcode: 0, errmsg: "ok", msgid: `reply-${metrics.replies}` });
    }
    return writeJson(response, 404, { errcode: 404, errmsg: "not found" });
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
    async triggerCallback(gatewayBaseUrl) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = crypto.randomBytes(8).toString("hex");
      const xml = [
        "<xml>",
        `<ToUserName><![CDATA[${WECOM_KF_E2E.corpId}]]></ToUserName>`,
        `<CreateTime>${timestamp}</CreateTime>`,
        "<MsgType><![CDATA[event]]></MsgType>",
        "<Event><![CDATA[kf_msg_or_event]]></Event>",
        "<Token><![CDATA[wecom-kf-e2e-sync-token]]></Token>",
        `<OpenKfId><![CDATA[${WECOM_KF_E2E.openKfId}]]></OpenKfId>`,
        "</xml>",
      ].join("");
      const encrypted = encryptCallbackXml(xml);
      const signature = signCallback(timestamp, nonce, encrypted);
      const query = new URLSearchParams({ msg_signature: signature, timestamp, nonce });
      const result = await fetch(`${gatewayBaseUrl}/wecom/kf?${query}`, {
        method: "POST",
        headers: { "content-type": "application/xml" },
        body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
      });
      const body = await result.text();
      if (!result.ok || body !== "success") {
        throw new Error(`WeCom KF callback rejected: HTTP ${result.status} ${body}`);
      }
      metrics.callbacks += 1;
    },
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    }),
  };
}
