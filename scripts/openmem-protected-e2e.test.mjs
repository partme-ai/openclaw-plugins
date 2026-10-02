import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { createProtectedChildEnv, startAuthenticatedProxy } from "./openmem-protected-e2e.mjs";

const temporary = mkdtempSync(join(tmpdir(), "openmem-proxy-test-"));
after(() => rmSync(temporary, { recursive: true, force: true }));

function probe(url, { ca, authorization } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      rejectUnauthorized: true,
      ca: ca ?? [],
      headers: authorization ? { authorization } : {},
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("authenticated HTTPS proxy rejects untrusted, anonymous and wrong-token requests", async () => {
  const backend = createServer((req, res) => {
    res.writeHead(req.url === "/failure" ? 500 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ path: req.url, authorization: req.headers.authorization ?? null }));
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  let proxy;
  try {
    proxy = await startAuthenticatedProxy({
      backendPort: backend.address().port,
      fixtureDir: temporary,
      proxyPort: 0,
    });
    await assert.rejects(probe(`${proxy.baseUrl}/healthz`), /certificate|self.signed|unable to verify/i);
    assert.equal((await probe(`${proxy.baseUrl}/healthz`, { ca: proxy.caPem })).status, 401);
    assert.equal((await probe(`${proxy.baseUrl}/healthz`, { ca: proxy.caPem, authorization: "Bearer wrong" })).status, 401);
    assert.equal(proxy.metrics.forwarded, 0);
    const ok = await probe(`${proxy.baseUrl}/healthz`, { ca: proxy.caPem, authorization: `Bearer ${proxy.token}` });
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body), { path: "/healthz", authorization: null });
    assert.equal(proxy.metrics.forwarded, 1);
    const metrics = await probe(`${proxy.baseUrl}/__e2e_metrics`, { ca: proxy.caPem, authorization: `Bearer ${proxy.token}` });
    assert.equal(metrics.status, 200);
    assert.equal(JSON.parse(metrics.body).paths["GET /healthz"], 1);
    assert.equal(JSON.parse(metrics.body).successfulPaths["GET /healthz"], 1);
    assert.equal(proxy.metrics.forwarded, 1);
    const failure = await probe(`${proxy.baseUrl}/failure`, { ca: proxy.caPem, authorization: `Bearer ${proxy.token}` });
    assert.equal(failure.status, 500);
    const afterFailure = JSON.parse((await probe(`${proxy.baseUrl}/__e2e_metrics`, {
      ca: proxy.caPem, authorization: `Bearer ${proxy.token}`,
    })).body);
    assert.equal(afterFailure.paths["GET /failure"], 1);
    assert.equal(afterFailure.successfulPaths["GET /failure"] ?? 0, 0);
  } finally {
    await proxy?.close();
    backend.closeAllConnections();
    await new Promise((resolve) => backend.close(resolve));
  }
});

test("protected run forces a fresh isolated profile despite inherited preservation settings", () => {
  const env = createProtectedChildEnv({
    OPENCLAW_E2E_PRESERVE_STATE: "1",
    OPENCLAW_E2E_STATE_DIR: "/tmp/stale-e2e-profile",
    OPENCLAW_STATE_DIR: "/tmp/personal-state",
    OPENCLAW_CONFIG_PATH: "/tmp/personal-state/openclaw.json",
    OPENCLAW_E2E_ALLOW_STATE_RESET: "1",
  }, temporary, { baseUrl: "https://127.0.0.1:12345", token: "test-only", certPath: join(temporary, "ca.pem") });
  const expectedState = join(temporary, "queue-e2e-profile");
  assert.equal(env.OPENCLAW_E2E_STATE_DIR, expectedState);
  assert.equal(env.OPENCLAW_STATE_DIR, expectedState);
  assert.equal(env.OPENCLAW_CONFIG_PATH, join(expectedState, "openclaw.json"));
  assert.equal(env.OPENCLAW_E2E_PRESERVE_STATE, "0");
  assert.equal(env.OPENCLAW_E2E_ALLOW_STATE_RESET, "0");
});

for (const [signal, expectedCode] of [["SIGINT", 130], ["SIGTERM", 143]]) test(`${signal} exits nonzero and removes the disposable certificate directory`, async () => {
  const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("openmem-protected-e2e-")));
  const child = spawn(process.execPath, [join(import.meta.dirname, "openmem-protected-e2e.mjs")], {
    env: { ...process.env, OPENCLAW_E2E_PRESERVE_STATE: "1" },
    stdio: "ignore",
  });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  await new Promise((resolve) => setTimeout(resolve, 750));
  assert.equal(child.kill(signal), true);
  let timeoutId;
  const timeout = new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error("signal cleanup timed out")), 15_000); });
  const result = await Promise.race([exited, timeout]);
  clearTimeout(timeoutId);
  assert.deepEqual(result, { code: expectedCode, signal: null });
  const after = readdirSync(tmpdir()).filter((name) => name.startsWith("openmem-protected-e2e-") && !before.has(name));
  assert.deepEqual(after, []);
});
