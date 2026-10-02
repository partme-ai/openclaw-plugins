import assert from "node:assert/strict";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { startAuthenticatedProxy } from "./openmem-protected-e2e.mjs";

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
    res.writeHead(200, { "content-type": "application/json" });
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
  } finally {
    await proxy?.close();
    backend.closeAllConnections();
    await new Promise((resolve) => backend.close(resolve));
  }
});
