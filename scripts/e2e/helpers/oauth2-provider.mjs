import { createHash, randomBytes } from "node:crypto";
import * as http from "node:http";

const CLIENT_ID = "openclaw-e2e";
const CLIENT_SECRET = "openclaw-e2e-client-secret";
const USER_ID = "oauth-e2e-user";
const SCOPE = "openid profile openclaw:operator";

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function formBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function validateClient(request, form, metrics) {
  const basic = request.headers.authorization?.match(/^Basic\s+(.+)$/i)?.[1];
  if (basic) {
    const [encodedId, encodedSecret] = Buffer.from(basic, "base64").toString("utf8").split(":", 2);
    const id = decodeURIComponent(encodedId.replace(/\+/g, " "));
    const secret = decodeURIComponent(encodedSecret.replace(/\+/g, " "));
    metrics.clientAuth = { method: "basic", id, secretLength: secret?.length ?? 0 };
    return id === CLIENT_ID && secret === CLIENT_SECRET;
  }
  metrics.clientAuth = {
    method: "post",
    id: form.get("client_id"),
    secretLength: form.get("client_secret")?.length ?? 0,
  };
  return form.get("client_id") === CLIENT_ID && form.get("client_secret") === CLIENT_SECRET;
}

function challenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function startOAuth2Provider(port) {
  const codes = new Map();
  const refreshTokens = new Set();
  const accessTokens = new Map();
  const metrics = {
    authorize: 0,
    codeExchange: 0,
    refresh: 0,
    introspect: 0,
    revoke: 0,
    pkceVerified: false,
    lastAccessToken: "",
    lastError: "",
    lastGrantType: "",
    clientAuth: null,
  };

  function issueAccessToken(expiresIn = 3600) {
    const token = `access-${randomBytes(18).toString("base64url")}`;
    accessTokens.set(token, { active: true, sub: USER_ID, tenantId: "e2e", scope: SCOPE });
    metrics.lastAccessToken = token;
    return { access_token: token, token_type: "Bearer", expires_in: expiresIn, scope: SCOPE };
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method === "GET" && url.pathname === "/authorize") {
      metrics.authorize += 1;
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      const codeChallenge = url.searchParams.get("code_challenge");
      if (
        url.searchParams.get("client_id") !== CLIENT_ID ||
        url.searchParams.get("response_type") !== "code" ||
        url.searchParams.get("code_challenge_method") !== "S256" ||
        !redirectUri || !state || !codeChallenge
      ) return json(response, 400, { error: "invalid_request" });

      const code = `code-${randomBytes(18).toString("base64url")}`;
      codes.set(code, { redirectUri, codeChallenge });
      const callback = new URL(redirectUri);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", state);
      response.writeHead(302, { location: callback.toString(), "cache-control": "no-store" });
      return response.end();
    }

    if (request.method === "POST" && url.pathname === "/token") {
      const form = await formBody(request);
      metrics.lastGrantType = form.get("grant_type") ?? "";
      if (!validateClient(request, form, metrics)) {
        metrics.lastError = "invalid_client";
        return json(response, 401, { error: "invalid_client" });
      }
      if (form.get("grant_type") === "authorization_code") {
        const code = form.get("code") ?? "";
        const transaction = codes.get(code);
        codes.delete(code);
        if (!transaction || transaction.redirectUri !== form.get("redirect_uri")) {
          metrics.lastError = `invalid_grant: code=${Boolean(transaction)}, redirect=${form.get("redirect_uri")}`;
          return json(response, 400, { error: "invalid_grant" });
        }
        const verifier = form.get("code_verifier") ?? "";
        if (challenge(verifier) !== transaction.codeChallenge) {
          metrics.lastError = `pkce_failed: verifier_length=${verifier.length}`;
          return json(response, 400, { error: "invalid_grant", error_description: "PKCE failed" });
        }
        metrics.pkceVerified = true;
        metrics.codeExchange += 1;
        const refreshToken = `refresh-${randomBytes(18).toString("base64url")}`;
        refreshTokens.add(refreshToken);
        return json(response, 200, { ...issueAccessToken(1), refresh_token: refreshToken });
      }
      if (form.get("grant_type") === "refresh_token") {
        const refreshToken = form.get("refresh_token") ?? "";
        if (!refreshTokens.has(refreshToken)) {
          metrics.lastError = "invalid_refresh_token";
          return json(response, 400, { error: "invalid_grant" });
        }
        metrics.refresh += 1;
        return json(response, 200, { ...issueAccessToken(), refresh_token: refreshToken });
      }
      metrics.lastError = `unsupported_grant_type:${form.get("grant_type")}`;
      return json(response, 400, { error: "unsupported_grant_type" });
    }

    if (request.method === "POST" && url.pathname === "/introspect") {
      const form = await formBody(request);
      if (!validateClient(request, form, metrics)) return json(response, 401, { error: "invalid_client" });
      metrics.introspect += 1;
      return json(response, 200, accessTokens.get(form.get("token") ?? "") ?? { active: false });
    }

    if (request.method === "POST" && url.pathname === "/revoke") {
      const form = await formBody(request);
      if (!validateClient(request, form, metrics)) return json(response, 401, { error: "invalid_client" });
      const token = form.get("token") ?? "";
      const claims = accessTokens.get(token);
      if (claims) claims.active = false;
      metrics.revoke += 1;
      response.writeHead(200, { "cache-control": "no-store" });
      return response.end();
    }

    return json(response, 404, { error: "not_found" });
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
