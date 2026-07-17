/** 企业微信 Agent OpenAPI 的本地隔离夹具；不会连接企业微信公网。 */
import * as http from "node:http";

export const WECOM_AGENT_E2E = {
  corpId: "wwwecome2ecorp0001",
  corpSecret: "wecom-e2e-corp-secret",
  accessToken: "wecom-e2e-access-token",
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

/** 启动 gettoken/message/send/appchat/send 夹具，并记录出站请求用于 E2E 断言。 */
export async function startWecomProvider(port) {
  const metrics = { tokenRequests: 0, replies: 0, lastReply: null };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/cgi-bin/gettoken") {
      metrics.tokenRequests += 1;
      if (
        url.searchParams.get("corpid") !== WECOM_AGENT_E2E.corpId ||
        url.searchParams.get("corpsecret") !== WECOM_AGENT_E2E.corpSecret
      ) {
        return writeJson(response, 200, { errcode: 40013, errmsg: "invalid corpid" });
      }
      return writeJson(response, 200, {
        errcode: 0,
        errmsg: "ok",
        access_token: WECOM_AGENT_E2E.accessToken,
        expires_in: 7200,
      });
    }
    if (url.searchParams.get("access_token") !== WECOM_AGENT_E2E.accessToken) {
      return writeJson(response, 200, { errcode: 40014, errmsg: "invalid access token" });
    }
    if (
      request.method === "POST" &&
      (url.pathname === "/cgi-bin/message/send" || url.pathname === "/cgi-bin/appchat/send")
    ) {
      metrics.replies += 1;
      metrics.lastReply = await readJson(request);
      return writeJson(response, 200, { errcode: 0, errmsg: "ok", msgid: `wecom-e2e-reply-${metrics.replies}` });
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
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    }),
  };
}
