#!/usr/bin/env node
/**
 * Real OpenClaw 2026.9.6 Control UI grant exercise.
 * Runs in its own temporary profile and port; it never changes the shared plugin E2E profile.
 * The full run waits for the server-issued Cookie's actual five-minute expiration.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  FIXTURE_ID, FIXTURE_PATH, selectFixtureGrant, selectPluginGrant, seedRouterDeadLetter, writeDisposableConfig,
} from "./fixtures/u3-auth-grant/runner-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(repoRoot, "scripts/fixtures/u3-auth-grant");
const routerDir = join(repoRoot, "extensions/router");
const tracingDir = join(repoRoot, "extensions/tracing");
const reportDir = join(fixtureDir, "reports");
const profile = "u3-auth-grant-e2e";

function resolveCliScript(bin) {
  const selected = realpathSync(bin);
  const shebang = readFileSync(selected, "utf8").split("\n", 1)[0];
  if (/^#!.*\bnode\b/.test(shebang)) return selected;
  if (!/^#!.*\b(?:sh|bash)\b/.test(shebang)) {
    throw new Error(`Unsupported OpenClaw CLI launcher: ${selected}`);
  }
  const packageDir = join(dirname(selected), "..", "openclaw");
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  if (pkg.name !== "openclaw" || typeof pkg.bin?.openclaw !== "string") {
    throw new Error("OpenClaw CLI package identity mismatch");
  }
  return realpathSync(join(packageDir, pkg.bin.openclaw));
}

async function unusedLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const port = server.address().port;
  await new Promise((resolveClosed) => server.close(resolveClosed));
  return port;
}

async function request(origin, path, init = {}) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000), ...init });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body, setCookie: response.headers.getSetCookie() };
}

async function waitReady(origin, child) {
  const deadline = performance.now() + 120_000;
  while (performance.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Gateway exited before readiness: ${child.exitCode ?? child.signalCode}`);
    }
    try {
      const status = await request(origin, "/readyz");
      if (status.status === 200 && status.body?.ready === true) return;
    } catch { /* startup race */ }
    await sleep(500);
  }
  throw new Error("Timed out waiting for isolated Gateway readiness");
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.status}`);
  }
}

async function stopOwnedChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
    sleep(5_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolveExit) => child.once("exit", resolveExit));
  }
}

async function run() {
  const fixtureOnly = process.argv.includes("--fixture-only");
  const selectedCli = process.env.OPENCLAW_BIN ?? join(repoRoot, "node_modules/.bin/openclaw");
  const cliScript = resolveCliScript(selectedCli);
  const versionText = execFileSync(process.execPath, [cliScript, "--version"], { encoding: "utf8" }).trim();
  if (!/\b2026\.9\.6\b/.test(versionText)) {
    throw new Error(`U3 real grant fixture requires OpenClaw 2026.9.6; selected ${versionText}`);
  }
  if (!fixtureOnly && !existsSync(join(routerDir, "dist/index.js"))) {
    throw new Error("Router dist/index.js is missing; build it or use --fixture-only");
  }
  if (!fixtureOnly && !existsSync(join(tracingDir, "dist/index.js"))) {
    throw new Error("Tracing dist/index.js is missing; build it or use --fixture-only");
  }
  const stateDir = mkdtempSync(join(tmpdir(), "openclaw-u3-auth-grant-e2e-"));
  const token = randomBytes(32).toString("hex");
  const port = await unusedLoopbackPort();
  const origin = `http://127.0.0.1:${port}`;
  const routerIncluded = !fixtureOnly;
  const configPath = writeDisposableConfig({ stateDir, fixtureDir, routerDir: routerIncluded ? routerDir : undefined,
    tracingDir: routerIncluded ? tracingDir : undefined, port, token });
  const seededDeadLetterId = routerIncluded ? seedRouterDeadLetter(stateDir) : undefined;
  const logPath = join(stateDir, "gateway.log");
  const logFd = openSync(logPath, "w", 0o600);
  const startedAt = new Date().toISOString();
  const report = { status: "FAIL", startedAt, hostVersion: "2026.9.6", profile, port,
    fixtureId: FIXTURE_ID, routerIncluded, seededDeadLetterId, assertions: [] };
  let child;
  try {
    child = spawn(process.execPath, [cliScript, "--profile", profile, "gateway", "run", "--allow-unconfigured", "--port", String(port)], {
      env: { ...process.env, HOME: stateDir, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath },
      stdio: ["ignore", logFd, logFd],
    });
    closeSync(logFd);
    await waitReady(origin, child);
    const gatewayPid = child.pid;
    const authorized = { Authorization: `Bearer ${token}` };
    const unauthorizedGet = await request(origin, FIXTURE_PATH);
    assertStatus(unauthorizedGet, 401, "anonymous fixture GET");
    report.assertions.push("anonymous fixture GET=401");

    const issuedAt = Date.now();
    const bootstrap = await request(origin, "/control-ui-config.json", { headers: authorized });
    assertStatus(bootstrap, 200, "Control UI bootstrap");
    const cookie = selectFixtureGrant(bootstrap.setCookie, bootstrap.body?.pluginFrameGrants, issuedAt);
    report.assertions.push("Gateway bootstrap minted a route-bound read Cookie");
    const managementCookies = routerIncluded ? {
      router: selectPluginGrant(bootstrap.setCookie, bootstrap.body?.pluginFrameGrants, issuedAt,
        { pluginId: "router", path: "/router/status", match: "exact" }),
      tracing: selectPluginGrant(bootstrap.setCookie, bootstrap.body?.pluginFrameGrants, issuedAt,
        { pluginId: "tracing", path: "/tracing/status", match: "exact" }),
    } : undefined;
    if (managementCookies) {
      for (const [id, grant] of Object.entries(managementCookies)) {
        const routePath = `/${id}/status`;
        assertStatus(await request(origin, routePath, { headers: { Cookie: grant.pair } }), 200,
          `${id} same-plugin Cookie GET`);
        assertStatus(await request(origin, routePath, { method: "POST", headers: { Cookie: grant.pair } }), 401,
          `${id} same-plugin read Cookie POST`);
        report.assertions.push(`${id} same-plugin signed Cookie GET=200, POST=401`);
      }
      assertStatus(await request(origin, "/tracing/status", { headers: { Cookie: managementCookies.router.pair } }), 401,
        "Router Cookie cross-plugin Tracing GET");
      report.assertions.push("Router Cookie cross-plugin Tracing GET=401");
    }

    const cookieHeaders = { Cookie: cookie.pair };
    const read = await request(origin, FIXTURE_PATH, { headers: cookieHeaders });
    assertStatus(read, 200, "Cookie fixture GET");
    if (read.body?.mutationCount !== 0) throw new Error("Fixture mutation count was not initially zero");
    report.assertions.push("genuine Cookie fixture GET=200; count=0");

    const deniedWrite = await request(origin, FIXTURE_PATH, { method: "POST", headers: cookieHeaders });
    assertStatus(deniedWrite, 401, "read-only Cookie fixture POST");
    const unchanged = await request(origin, FIXTURE_PATH, { headers: authorized });
    if (unchanged.status !== 200 || unchanged.body?.mutationCount !== 0) {
      throw new Error("denied Cookie POST reached fixture mutation handler");
    }
    report.assertions.push("same-plugin Cookie POST=401; no handler side effect");

    if (routerIncluded) {
      const beforeStatus = await request(origin, "/router/status", { headers: authorized });
      const beforeDlq = await request(origin, "/router/dlq", { headers: authorized });
      if (beforeStatus.status !== 200 || beforeDlq.status !== 200 ||
          !beforeDlq.body?.data?.some((entry) => entry.id === seededDeadLetterId)) {
        throw new Error("Router fixture DLQ was not available before cross-plugin check");
      }
      const crossRead = await request(origin, "/router/dlq", { headers: cookieHeaders });
      assertStatus(crossRead, 401, "cross-plugin Cookie Router DLQ GET");
      const crossWrite = await request(origin, "/router/dlq/replay?limit=1", {
        method: "POST", headers: cookieHeaders,
      });
      assertStatus(crossWrite, 401, "cross-plugin Cookie Router replay POST");
      const samePluginReadOnlyReplay = await request(origin, "/router/dlq/replay?limit=1", {
        method: "POST", headers: { Cookie: managementCookies.router.pair },
      });
      assertStatus(samePluginReadOnlyReplay, 401, "same-plugin read Cookie Router replay POST");
      const afterStatus = await request(origin, "/router/status", { headers: authorized });
      const afterDlq = await request(origin, "/router/dlq", { headers: authorized });
      if (JSON.stringify(afterStatus.body?.data) !== JSON.stringify(beforeStatus.body?.data) ||
          JSON.stringify(afterDlq.body?.data) !== JSON.stringify(beforeDlq.body?.data)) {
        throw new Error("denied cross-plugin Cookie POST changed Router state");
      }
      report.assertions.push("cross-plugin Cookie Router DLQ GET=401 and replay POST=401; DLQ and delivery unchanged");
      report.assertions.push("same-plugin Router read Cookie replay POST=401; DLQ and delivery unchanged");
    }

    const authorizedWrite = await request(origin, FIXTURE_PATH, { method: "POST", headers: authorized });
    if (authorizedWrite.status !== 200 || authorizedWrite.body?.mutationCount !== 1) {
      throw new Error("explicit Gateway bearer did not reach fixture mutation handler exactly once");
    }
    report.assertions.push("explicit bearer POST reaches fixture handler once");

    const waitMs = Math.max(0, cookie.expiresAt + 1_500 - Date.now());
    console.log(`[u3-grant] live Cookie checks passed; waiting ${Math.ceil(waitMs / 1000)}s for its real server expiry`);
    const timer = setInterval(() => console.log("[u3-grant] waiting for server-issued Cookie expiry"), 30_000);
    try { await sleep(waitMs); } finally { clearInterval(timer); }
    if (child.pid !== gatewayPid || child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Gateway process changed before expiry check");
    }
    const expiredRead = await request(origin, FIXTURE_PATH, { headers: cookieHeaders });
    assertStatus(expiredRead, 401, "expired genuine Cookie fixture GET");
    if (managementCookies) {
      for (const [id, grant] of Object.entries(managementCookies)) {
        assertStatus(await request(origin, `/${id}/status`, { headers: { Cookie: grant.pair } }), 401,
          `expired ${id} Cookie GET`);
      }
      report.assertions.push("Router and Tracing signed Cookies expired in the same Gateway process");
    }
    const stillAuthorized = await request(origin, FIXTURE_PATH, { headers: authorized });
    if (stillAuthorized.status !== 200 || stillAuthorized.body?.mutationCount !== 1) {
      throw new Error("Gateway was not healthy in the same process after Cookie expiry");
    }
    report.assertions.push("same signed Cookie GET=401 after real five-minute TTL in same Gateway process");
    report.status = "PASS";
    console.log(`[u3-grant] PASS: ${report.assertions.join("; ")}`);
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    console.error(`[u3-grant] FAIL: ${report.error}; isolated Gateway log: ${logPath}`);
    throw error;
  } finally {
    if (child) await stopOwnedChild(child);
    else closeSync(logFd);
    report.finishedAt = new Date().toISOString();
    mkdirSync(reportDir, { recursive: true });
    const reportPath = join(reportDir, `${startedAt.replaceAll(":", "-")}-${report.status.toLowerCase()}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`[u3-grant] report: ${reportPath}`);
    if (report.status === "PASS") rmSync(stateDir, { recursive: true, force: true });
    else console.error(`[u3-grant] preserved isolated state: ${stateDir}`);
  }
}

run().catch(() => { process.exitCode = 1; });
