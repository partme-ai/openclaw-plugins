/** 美团 MTOp form/signature 的本地协议夹具，不接触真实商家凭据。 */
import { createHash, timingSafeEqual } from "node:crypto";
import * as http from "node:http";

const SIGN_KEY = "meituan-e2e-sign-key";

function expectedSign(fields) {
  let base = SIGN_KEY;
  for (const key of [...fields.keys()].sort()) {
    if (key.toLowerCase() === "sign") continue;
    const value = fields.get(key);
    if (value) base += key + value;
  }
  return createHash("sha1").update(base, "utf8").digest("hex");
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{40}$/.test(left) || !/^[a-f0-9]{40}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export async function startMeituanProvider(port) {
  const metrics = { requests: 0, lastRequest: null };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method !== "POST" || url.pathname !== "/e2e/shop/query") {
      return writeJson(response, 404, { code: "NOT_FOUND" });
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    const fields = new URLSearchParams(raw);
    const sign = fields.get("sign") ?? "";
    const expected = expectedSign(fields);
    metrics.requests += 1;
    metrics.lastRequest = {
      pathname: url.pathname,
      contentType: request.headers["content-type"],
      developerHeader: request.headers.developerid,
      fields: Object.fromEntries(fields.entries()),
      signatureValid: safeEqualHex(sign, expected),
    };
    if (!metrics.lastRequest.signatureValid) {
      return writeJson(response, 401, { code: "INVALID_SIGN" });
    }
    return writeJson(response, 200, {
      code: "OP_SUCCESS",
      traceId: "meituan-e2e-trace",
      data: { shopId: "E2E-SHOP", name: "OpenClaw E2E 门店" },
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
