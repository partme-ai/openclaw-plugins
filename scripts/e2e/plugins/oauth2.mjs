import * as http from "node:http";
import { startOAuth2Provider } from "../helpers/oauth2-provider.mjs";
import { oauth2ClientAddress } from "../config/plugins/oauth2.mjs";
import { runAdapterTest } from "./_context.mjs";

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function manualFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      localAddress: oauth2ClientAddress(),
      timeout: 10_000,
    }, (response) => {
      response.on("error", reject);
      response.resume();
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
        headers: {
          get(name) {
            const value = response.headers[name.toLowerCase()];
            return Array.isArray(value) ? value[0] ?? null : value ?? null;
          },
        },
      }));
    });
    request.on("timeout", () => request.destroy(new Error("OAuth2 E2E request timed out")));
    request.on("error", reject);
    request.end();
  });
}

function safeProviderMetrics(metrics) {
  return JSON.stringify({
    pkceVerified: metrics.pkceVerified,
    codeExchange: metrics.codeExchange,
    refresh: metrics.refresh,
    introspect: metrics.introspect,
    revoke: metrics.revoke,
    lastError: metrics.lastError,
  });
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testOAuth2(ctx, results) {
  await runAdapterTest(
    ctx,
    "oauth2",
    async () => {
      const provider = await startOAuth2Provider(ctx.ports.oauth2Provider);
      const proxy = `http://127.0.0.1:${ctx.ports.oauth2Proxy}`;
      try {
        await ctx.waitFor(async () => {
          try {
            return (await manualFetch(`${proxy}/health`)).ok;
          } catch {
            return false;
          }
        }, { label: "OAuth2 proxy listener", timeoutMs: 30_000 });

        const anonymous = await manualFetch(`${proxy}/auth/oauth2/status`);
        if (anonymous.status !== 401) throw new Error(`anonymous OAuth2 status → ${anonymous.status}, expected 401`);

        const login = await manualFetch(`${proxy}/auth/oauth2/login?returnTo=%2Fauth%2Foauth2%2Fstatus`);
        if (login.status !== 302) throw new Error(`OAuth2 login → ${login.status}, expected 302`);
        const stateCookie = cookieFrom(login);
        const authorizeUrl = login.headers.get("location");
        if (!stateCookie || !authorizeUrl) throw new Error("OAuth2 login did not return state cookie and authorization URL");

        const authorize = await manualFetch(authorizeUrl);
        const callbackUrl = authorize.headers.get("location");
        if (authorize.status !== 302 || !callbackUrl) throw new Error("OAuth2 provider did not authorize the PKCE request");

        const callbackRequestUrl = new URL(callbackUrl);
        if (callbackRequestUrl.hostname !== "127.0.0.1" ||
            callbackRequestUrl.port !== String(ctx.ports.oauth2Proxy) ||
            callbackRequestUrl.pathname !== "/auth/oauth2/callback") {
          throw new Error("OAuth2 provider returned an unexpected callback destination");
        }
        const callback = await manualFetch(callbackRequestUrl, { headers: { cookie: stateCookie } });
        const sessionCookie = cookieFrom(callback);
        if (callback.status !== 302 || !sessionCookie) {
          throw new Error(`OAuth2 callback → ${callback.status}, session missing; provider=${safeProviderMetrics(provider.metrics)}`);
        }

        const authenticated = await manualFetch(`${proxy}/auth/oauth2/status`, {
          headers: { cookie: sessionCookie, "x-forwarded-user": "spoofed-user" },
        });
        if (authenticated.status !== 200) {
          throw new Error(`OAuth2 session → OpenClaw trusted-proxy status failed: ${authenticated.status}`);
        }

        const bearer = await manualFetch(`${proxy}/auth/oauth2/status`, {
          headers: {
            authorization: `Bearer ${provider.metrics.lastAccessToken}`,
            "x-forwarded-user": "spoofed-user",
          },
        });
        if (bearer.status !== 200) throw new Error(`OAuth2 bearer introspection → ${bearer.status}`);
        const invalidBearer = await manualFetch(`${proxy}/auth/oauth2/status`, {
          headers: { authorization: "Bearer invalid-token" },
        });
        if (invalidBearer.status !== 401) throw new Error(`invalid bearer → ${invalidBearer.status}, expected 401`);

        const logout = await manualFetch(`${proxy}/auth/oauth2/logout`, {
          method: "POST",
          headers: { cookie: sessionCookie },
        });
        if (logout.status !== 302) throw new Error(`OAuth2 logout → ${logout.status}`);
        const staleSession = await manualFetch(`${proxy}/auth/oauth2/status`, { headers: { cookie: sessionCookie } });
        if (staleSession.status !== 401) throw new Error(`revoked session → ${staleSession.status}, expected 401`);

        if (!provider.metrics.pkceVerified || provider.metrics.codeExchange !== 1) {
          throw new Error("OAuth2 Authorization Code + PKCE was not verified by the provider");
        }
        if (provider.metrics.refresh < 1 || provider.metrics.introspect < 2 || provider.metrics.revoke !== 1) {
          throw new Error(`OAuth2 lifecycle incomplete: ${safeProviderMetrics(provider.metrics)}`);
        }
      } finally {
        await provider.close();
      }
    },
    {
      service: `http://127.0.0.1:${ctx.ports.oauth2Proxy} (client source ${oauth2ClientAddress()})`,
      method: "Authorization Code + PKCE + refresh + introspection + revoke + OpenClaw trusted-proxy",
    },
    results,
  );
}
