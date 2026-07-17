/** 小红书 Ark Header/Query 签名的本地协议夹具，不接触真实商家凭据。 */
import { createHash, timingSafeEqual } from "node:crypto";
import * as http from "node:http";

const APP_KEY = "rednode-e2e-app-key";
const APP_SECRET = "rednode-e2e-app-secret";

/** 按公开 Ark 规则独立重算签名，避免直接复用被测插件实现造成同错同过。 */
function expectedSign(pathname, searchParams, timestamp) {
  const parameters = new Map(searchParams.entries());
  parameters.set("app-key", APP_KEY);
  parameters.set("timestamp", timestamp);
  const canonical = [...parameters.entries()]
    .filter(([, value]) => value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return createHash("md5")
    .update(`${pathname}?${canonical}${APP_SECRET}`, "utf8")
    .digest("hex");
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{32}$/.test(left) || !/^[a-f0-9]{32}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export async function startRednodeProvider(port) {
  const metrics = { requests: 0, lastRequest: null, allSignaturesValid: true };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method !== "GET" || url.pathname !== "/ark/open_api/v1/items") {
      return writeJson(response, 404, { success: false, error_code: "NOT_FOUND" });
    }
    const timestamp = String(request.headers.timestamp ?? "");
    const sign = String(request.headers.sign ?? "");
    const signatureValid =
      request.headers["app-key"] === APP_KEY &&
      /^\d{10}$/.test(timestamp) &&
      safeEqualHex(sign, expectedSign(url.pathname, url.searchParams, timestamp));
    metrics.requests += 1;
    metrics.allSignaturesValid &&= signatureValid;
    metrics.lastRequest = {
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      appKeyHeader: request.headers["app-key"],
      signatureValid,
    };
    if (!signatureValid) {
      return writeJson(response, 401, { success: false, error_code: "INVALID_SIGN" });
    }
    // 第一次返回官方列出的临时失败，证明只有 GET 会重新签名并安全重试。
    if (metrics.requests === 1) {
      return writeJson(response, 502, { success: false, error_code: "TEMPORARY" });
    }
    return writeJson(response, 200, {
      success: true,
      data: { items: [{ item_id: "RED-E2E-1", name: "OpenClaw E2E 商品" }] },
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
