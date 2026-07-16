import { readFileSync } from "node:fs";
import * as https from "node:https";
import { join } from "node:path";

import { STATE_DIR } from "../lib/utils.mjs";
import { runAdapterTest } from "./_context.mjs";

const CERT_DIR = join(STATE_DIR, "mtls-certs");

function request(port, credentials = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: "127.0.0.1",
      port,
      path: "/mtls/status",
      ca: readFileSync(join(CERT_DIR, "ca.crt")),
      ...credentials,
      headers: { "x-forwarded-user": "spoofed-user" },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => {
        let json;
        try { json = JSON.parse(body); } catch { json = body; }
        resolve({ status: response.statusCode ?? 0, json });
      });
    });
    req.setTimeout(10_000, () => req.destroy(new Error("mTLS E2E request timed out")));
    req.on("error", reject);
    req.end();
  });
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testMtls(ctx, results) {
  await runAdapterTest(
    ctx,
    "mtls",
    async () => {
      await ctx.waitFor(
        async () => {
          try {
            return (await request(ctx.ports.mtlsHttps)).status === 401;
          } catch {
            return false;
          }
        },
        { label: "mTLS proxy listener", timeoutMs: 30_000 },
      );
      const unauthenticated = await request(ctx.ports.mtlsHttps);
      if (unauthenticated.status !== 401) {
        throw new Error(`mTLS request without certificate → ${unauthenticated.status}, expected 401`);
      }

      const rogue = await request(ctx.ports.mtlsHttps, {
        cert: readFileSync(join(CERT_DIR, "rogue-client.crt")),
        key: readFileSync(join(CERT_DIR, "rogue-client.key")),
      });
      if (rogue.status !== 401) {
        throw new Error(`mTLS request with untrusted certificate → ${rogue.status}, expected 401`);
      }

      const authenticated = await request(ctx.ports.mtlsHttps, {
        cert: readFileSync(join(CERT_DIR, "client.crt")),
        key: readFileSync(join(CERT_DIR, "client.key")),
      });
      if (authenticated.status !== 200 || authenticated.json?.ok !== true || authenticated.json?.running !== true) {
        throw new Error(`verified mTLS → OpenClaw trusted-proxy status failed: ${authenticated.status}`);
      }
    },
    {
      service: `https://127.0.0.1:${ctx.ports.mtlsHttps}`,
      method: "OpenSSL client cert + fail-closed policy + OpenClaw trusted-proxy auth",
    },
    results,
  );
}
