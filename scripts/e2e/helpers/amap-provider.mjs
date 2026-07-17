/** 高德地点搜索 2.0 的本地协议夹具：只监听 loopback，不接触真实 Key。 */
import * as http from "node:http";

function writeJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

export async function startAmapProvider(port) {
  const metrics = { requests: 0, lastRequest: null };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method !== "GET" || url.pathname !== "/v5/place/text") {
      return writeJson(response, 404, { status: "0", info: "NOT_FOUND", infocode: "404" });
    }
    metrics.requests += 1;
    metrics.lastRequest = {
      method: request.method,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
    };

    // 首次 503、第二次成功，验证安装态客户端只对安全 GET 做有限重试。
    if (metrics.requests === 1) {
      return writeJson(response, 503, { status: "0", info: "TEMPORARY", infocode: "10016" });
    }
    return writeJson(response, 200, {
      status: "1",
      info: "OK",
      infocode: "10000",
      count: "1",
      pois: [{ id: "B0AMAPE2E", name: "OpenClaw E2E 咖啡馆", location: "116.397,39.908" }],
    });
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
