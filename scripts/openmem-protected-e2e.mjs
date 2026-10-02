#!/usr/bin/env node
/**
 * Local installed OpenMem E2E behind a disposable authenticated HTTPS proxy.
 * The production OpenMem entrypoint is started by the existing E2E runner.
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const E2E_DIR = join(ROOT, "scripts/e2e");
const TOKEN_ENV = "OPENMEM_E2E_PROXY_TOKEN";

function httpsProbe(url, { ca, authorization } = {}) {
  return new Promise((resolveProbe, rejectProbe) => {
    const request = httpsRequest(url, {
      ca: ca ?? [],
      rejectUnauthorized: true,
      headers: authorization ? { authorization } : {},
    }, (response) => {
      response.resume();
      response.on("end", () => resolveProbe(response.statusCode));
    });
    request.once("error", rejectProbe);
    request.end();
  });
}

/** Start one loopback-only TLS proxy; credentials are never written to disk. */
export async function startAuthenticatedProxy({ backendPort, fixtureDir, proxyPort = 0 }) {
  const certPath = join(fixtureDir, "ca.pem");
  const keyPath = join(fixtureDir, "key.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certPath, "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1",
  ], { stdio: "ignore" });
  const caPem = readFileSync(certPath, "utf8");
  const token = randomBytes(32).toString("hex");
  const metrics = { forwarded: 0, denied: 0, paths: Object.create(null) };
  const server = createHttpsServer({ key: readFileSync(keyPath), cert: caPem }, (req, res) => {
    const actual = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      metrics.denied++;
      res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
      res.end('{"error":"unauthorized"}');
      return;
    }
    const pathname = new URL(req.url ?? "/", "https://127.0.0.1").pathname;
    const route = `${req.method} ${pathname}`;
    metrics.forwarded++;
    metrics.paths[route] = (metrics.paths[route] ?? 0) + 1;
    const { authorization: _authorization, ...forwardHeaders } = req.headers;
    const upstream = httpRequest({
      hostname: "127.0.0.1",
      port: backendPort,
      path: req.url,
      method: req.method,
      headers: { ...forwardHeaders, host: `127.0.0.1:${backendPort}` },
    }, (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    });
    upstream.once("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end('{"error":"upstream unavailable"}');
    });
    req.pipe(upstream);
  });
  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(proxyPort, "127.0.0.1", resolveListen);
    });
  } catch (error) {
    server.close();
    throw error;
  }
  const baseUrl = `https://127.0.0.1:${server.address().port}`;
  return {
    baseUrl, caPem, certPath, token, metrics,
    async close() {
      server.closeAllConnections();
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

async function verifyBoundary(proxy) {
  let tlsRejected = false;
  try {
    await httpsProbe(`${proxy.baseUrl}/healthz`);
  } catch (error) {
    tlsRejected = /CERT|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(String(error?.code ?? error));
  }
  if (!tlsRejected) throw new Error("untrusted proxy certificate was not rejected");
  const anonymous = await httpsProbe(`${proxy.baseUrl}/healthz`, { ca: proxy.caPem });
  const wrongToken = await httpsProbe(`${proxy.baseUrl}/healthz`, { ca: proxy.caPem, authorization: "Bearer invalid-e2e-token" });
  if (anonymous !== 401 || wrongToken !== 401 || proxy.metrics.forwarded !== 0) {
    throw new Error("proxy did not reject unauthenticated traffic before forwarding");
  }
  return { tlsRejected, anonymous, wrongToken };
}

async function runChild(env) {
  const child = spawn(process.execPath, [join(E2E_DIR, "run-e2e.mjs"), "--plugins", "openmem"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

/** Execute and archive one protected local installed-plugin run. */
export async function runProtectedE2E() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "openmem-protected-e2e-"));
  let proxy;
  try {
    const backendPort = Number(process.env.E2E_OPENMEM_PORT ?? 13317);
    proxy = await startAuthenticatedProxy({ backendPort, fixtureDir });
    const negatives = await verifyBoundary(proxy);
    const env = {
      ...process.env,
      OPENCLAW_E2E_HOST_GATEWAY: "1",
      OPENMEM_E2E_PROTECTED: "1",
      OPENMEM_E2E_PROXY_URL: proxy.baseUrl,
      [TOKEN_ENV]: proxy.token,
      NODE_EXTRA_CA_CERTS: proxy.certPath,
    };
    const childStartedAt = Date.now();
    const child = await runChild(env);
    if (child.code !== 0 || child.signal !== null) {
      throw new Error(`installed OpenMem E2E child exited ${child.code ?? `on ${child.signal}`}; see child output above`);
    }
    const stateDir = env.OPENCLAW_E2E_STATE_DIR ?? join(process.env.HOME, ".openclaw-queue-e2e");
    const configText = readFileSync(join(stateDir, "openclaw.json"), "utf8");
    const config = JSON.parse(configText);
    const openmem = config.plugins?.entries?.openmem?.config;
    if (openmem?.baseUrl !== proxy.baseUrl || openmem.apiKeyEnv !== TOKEN_ENV || configText.includes(proxy.token)) {
      throw new Error("installed OpenMem config did not use the protected endpoint and env-only credential");
    }
    const reportText = readFileSync(join(E2E_DIR, "e2e-report.json"), "utf8");
    const report = JSON.parse(reportText);
    if (reportText.includes(proxy.token)) throw new Error("E2E report contains proxy credential");
    if (!report.archivePath || !existsSync(report.archivePath) || !report.candidateManifest ||
        Date.parse(report.startedAt) < childStartedAt - 1_000) {
      throw new Error("protected run lacks a current installed-candidate E2E archive");
    }
    const gatewayLog = join(E2E_DIR, "gateway.log");
    if (existsSync(gatewayLog) && readFileSync(gatewayLog, "utf8").includes(proxy.token)) {
      throw new Error("Gateway log contains proxy credential");
    }
    const installedCandidateSha256 = report.installed?.find((entry) => entry.id === "openmem")?.artifactSha256;
    if (!/^[a-f0-9]{64}$/.test(installedCandidateSha256 ?? "")) {
      throw new Error("protected run lacks installed OpenMem tarball SHA-256");
    }
    const paths = proxy.metrics.paths;
    const required = ["POST /sessions/start", "POST /events/ingest", "POST /inspect/search"];
    const missing = required.filter((route) => !paths[route]);
    const commitCount = Object.entries(paths).filter(([route]) => /^POST \/sessions\/[^/]+\/commit$/.test(route)).reduce((sum, [, count]) => sum + count, 0);
    const passed = report.plugins?.length === 1 && report.plugins[0] === "openmem" &&
      report.e2e?.length === 1 && report.e2e[0].result === "PASS" &&
      report.skipCount === 0 && report.skipInstall === false && report.skipBrowser === false &&
      missing.length === 0 && commitCount >= 3;
    const protectedReport = {
      startedAt: report.startedAt,
      finishedAt: new Date().toISOString(),
      wrapperSha256: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex"),
      childExitCode: child.code,
      childSignal: child.signal,
      openClawVersion: report.host?.version,
      installedCandidateSha256,
      e2eArchive: report.archivePath,
      skipCount: report.skipCount,
      proxy: { baseUrl: proxy.baseUrl, forwarded: proxy.metrics.forwarded, denied: proxy.metrics.denied, paths },
      negatives,
      commitCount,
      result: passed ? "PASS" : "FAIL",
      ...(passed ? {} : { failure: `missing proxy routes: ${missing.join(", ")}; commitCount=${commitCount}; child=${child.code}` }),
    };
    const archiveDir = join(E2E_DIR, "reports/protected");
    mkdirSync(archiveDir, { recursive: true });
    const archivePath = join(archiveDir, `${new Date().toISOString().replaceAll(":", "-")}-openmem-${randomUUID()}.json`);
    writeFileSync(archivePath, JSON.stringify(protectedReport, null, 2), { flag: "wx" });
    console.log(`[openmem protected] ${protectedReport.result}: ${archivePath}`);
    if (!passed) throw new Error("protected OpenMem E2E assertions failed");
    return { archivePath, report: protectedReport };
  } finally {
    await proxy?.close();
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProtectedE2E().catch((error) => {
    console.error("[openmem protected] failed:", error);
    process.exitCode = 1;
  });
}
