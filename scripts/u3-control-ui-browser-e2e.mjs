#!/usr/bin/env node
/** Local Chrome exercise of the real OpenClaw Control UI Router/Tracing tabs. */
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { writeDisposableConfig } from "./fixtures/u3-auth-grant/runner-lib.mjs";
import { assertCleanPackedArtifact, preparePackedCandidate, reviewedArtifactDigest, trustedE2ELinkArgs } from "./e2e/lib/install.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const routerDir = join(root, "extensions/router");
const tracingDir = join(root, "extensions/tracing");
const fixtureDir = join(root, "scripts/fixtures/u3-auth-grant");
const cacheDir = join(root, "node_modules/.cache/u3-control-ui-browser");
const chromePath = process.env.OPENCLAW_E2E_BROWSER_EXECUTABLE ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const views = [
  { name: "mobile", width: 390, height: 884 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 1024 },
];
const tabs = [
  { name: "router", label: "Router status", path: "/router/status" },
  { name: "tracing", label: "Tracing status", path: "/tracing/status" },
];

function cliScript(bin) {
  const selected = realpathSync(bin);
  const shebang = readFileSync(selected, "utf8").split("\n", 1)[0];
  if (/^#!.*\bnode\b/.test(shebang)) return selected;
  if (!/^#!.*\b(?:sh|bash)\b/.test(shebang)) throw new Error(`Unsupported OpenClaw CLI: ${selected}`);
  const packageDir = join(dirname(selected), "..", "openclaw");
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  if (pkg.name !== "openclaw" || typeof pkg.bin?.openclaw !== "string") throw new Error("OpenClaw CLI package identity mismatch");
  return realpathSync(join(packageDir, pkg.bin.openclaw));
}

function treeSha(dir, include = () => true) {
  const digest = createHash("sha256");
  function visit(path, rel) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (!include(nextRel, entry)) continue;
      if (entry.isDirectory()) visit(join(path, entry.name), nextRel);
      else if (entry.isFile()) {
        digest.update(nextRel).update("\0").update(readFileSync(join(path, entry.name))).update("\0");
      }
    }
  }
  visit(dir, "");
  return digest.digest("hex");
}

function sourceSha(dir) {
  return treeSha(dir, (rel, entry) => {
    if (entry.isDirectory()) return !["dist", "node_modules", "coverage", ".turbo"].includes(entry.name);
    return rel.startsWith("src/") || rel === "package.json" || rel === "tsconfig.json" || rel.startsWith("tsup.config") || rel === "openclaw.plugin.json";
  });
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ready);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function stopChild(child, label) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const ended = await Promise.race([new Promise((done) => child.once("exit", () => done(true))), sleep(5_000).then(() => false)]);
  if (!ended && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    const killed = await Promise.race([new Promise((done) => child.once("exit", () => done(true))), sleep(5_000).then(() => false)]);
    if (!killed) throw new Error(`${label} did not exit after SIGKILL`);
  }
}

async function waitReady(origin, child, abortSignal) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    abortSignal.throwIfAborted();
    if (child.spawnError) throw child.spawnError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("isolated Gateway exited before readiness");
    try {
      const response = await fetch(`${origin}/readyz`, { signal: AbortSignal.any([AbortSignal.timeout(2_000), abortSignal]) });
      if (response.status === 200 && (await response.json())?.ready === true) return;
    } catch { /* startup race */ }
    abortSignal.throwIfAborted();
    await sleep(300);
  }
  throw new Error("isolated Gateway readiness timeout");
}

async function waitChromeCdp(port, child, abortSignal) {
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    abortSignal.throwIfAborted();
    if (child.spawnError) throw child.spawnError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Chrome exited before DevTools readiness");
    try {
      const response = await fetch(`${origin}/json/version`, { signal: AbortSignal.any([AbortSignal.timeout(1_000), abortSignal]) });
      if (response.ok && (await response.json()).webSocketDebuggerUrl) return origin;
    } catch { /* startup race */ }
    abortSignal.throwIfAborted();
    await sleep(200);
  }
  throw new Error("Chrome DevTools readiness timeout");
}

function buildEvidence(dir) {
  const dist = join(dir, "dist");
  if (!existsSync(join(dist, "index.js"))) throw new Error(`${dir} build omitted dist/index.js`);
  return { sourceSha256: sourceSha(dir), distSha256: treeSha(dist) };
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertInstalledIdentity(id, sourceDir, installedDir, expectedDigest) {
  const sourcePackage = JSON.parse(readFileSync(join(sourceDir, "package.json"), "utf8"));
  const installedPackage = JSON.parse(readFileSync(join(installedDir, "package.json"), "utf8"));
  const sourceManifest = JSON.parse(readFileSync(join(sourceDir, "openclaw.plugin.json"), "utf8"));
  const installedManifest = JSON.parse(readFileSync(join(installedDir, "openclaw.plugin.json"), "utf8"));
  if (realpathSync(installedDir) === realpathSync(sourceDir) ||
      installedPackage.name !== sourcePackage.name || installedPackage.version !== sourcePackage.version ||
      installedManifest.id !== id || installedManifest.version !== sourceManifest.version ||
      JSON.stringify(installedManifest.capabilities ?? {}) !== JSON.stringify(sourceManifest.capabilities ?? {}) ||
      reviewedArtifactDigest(installedDir) !== expectedDigest || !existsSync(join(installedDir, "dist/index.js"))) {
    throw new Error(`${id}: extracted package identity, capabilities, content, or dist mismatch`);
  }
  for (const section of ["dependencies", "optionalDependencies"]) {
    if (Object.keys(installedPackage[section] ?? {}).length) throw new Error(`${id}: production dependencies require an explicit installed dependency step`);
  }
  return { name: installedPackage.name, version: installedPackage.version,
    capabilities: installedManifest.capabilities ?? {}, artifactSha256: expectedDigest,
    installedDistSha256: treeSha(join(installedDir, "dist")) };
}

function syntheticModel(configPath) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.models = { mode: "replace", providers: { "u3-browser-fixture": {
    baseUrl: "http://127.0.0.1:9/v1", apiKey: "local-unused-fixture-key", api: "openai-completions",
    models: [{ id: "no-inference", name: "U3 browser fixture", reasoning: false, input: ["text"], contextWindow: 131072, maxTokens: 1024 }],
  } } };
  config.agents = { defaults: { model: { primary: "u3-browser-fixture/no-inference" },
    models: { "u3-browser-fixture/no-inference": { agentRuntime: { id: "openclaw" } } } } };
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

async function inspectTab(page, origin, view, tab, outputDir) {
  // Mobile and tablet navigation is behind the real Control UI menu button.
  const direct = page.getByText(tab.label, { exact: true });
  const box = await direct.boundingBox();
  if (!box || box.x < 0 || box.y < 0 || box.x >= view.width || box.y >= view.height) {
    const menu = page.locator(".topbar-nav-toggle:visible, .chat-pane__nav-toggle:visible").first();
    if (!(await menu.count())) throw new Error(`${view.name}/${tab.name}: Control UI navigation toggle missing`);
    await menu.click();
  }
  const frameResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === tab.path &&
    response.request().resourceType() === "document", { timeout: 15_000 }).then((response) => response, (error) => error);
  await direct.click({ timeout: 15_000 });
  const frame = page.locator(`iframe[src="${tab.path}"]`);
  await frame.waitFor({ state: "attached", timeout: 15_000 });
  const frameResponse = await frameResponsePromise;
  if (frameResponse instanceof Error) throw frameResponse;
  if (frameResponse.status() !== 200) throw new Error(`${view.name}/${tab.name}: iframe HTTP ${frameResponse.status()}`);
  const iframe = await frame.elementHandle();
  const contentFrame = await iframe.contentFrame();
  await contentFrame.waitForLoadState("domcontentloaded", { timeout: 15_000 });
  const url = new URL(contentFrame.url());
  if (url.origin !== origin || url.pathname !== tab.path) throw new Error(`${view.name}/${tab.name}: iframe route mismatch: ${url}`);
  const bodyText = await contentFrame.locator("body").innerText();
  let body;
  try { body = JSON.parse(bodyText); } catch { throw new Error(`${view.name}/${tab.name}: iframe did not display JSON`); }
  if (body?.ok !== true || typeof body?.data !== "object" || body.data === null) {
    throw new Error(`${view.name}/${tab.name}: plugin status JSON was not ok`);
  }
  const screenshot = join(outputDir, `${view.name}-${tab.name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(`[u3-browser] ${view.name}/${tab.name} screenshot: ${screenshot}`);
  return { label: tab.label, path: tab.path, frameHttpStatus: frameResponse.status(),
    routeVerified: true, statusOk: true, screenshot };
}

async function main() {
  const installedCandidate = process.argv.includes("--installed-candidate");
  const startedAt = new Date().toISOString();
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  chmodSync(cacheDir, 0o700);
  const outputDir = join(cacheDir, startedAt.replaceAll(":", "-"));
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  chmodSync(outputDir, 0o700);
  const reportPath = join(outputDir, "report.json");
  const report = { status: "FAIL", startedAt, mode: installedCandidate ? "installed-candidate" : "source",
    hostVersion: "2026.9.6", chrome: chromePath, build: {}, candidates: [], commandRuns: [], evidence: [], cleanup: {},
    limitations: [installedCandidate ? "Local packed candidate and loopback browser only; no deployed proxy or vendor callback evidence." :
      "Local source/dist and loopback browser only; no installed tarball, deployed proxy, or vendor callback evidence."] };
  let stateDir, gateway, browser, chromeChild, commandChild, commandShutdown;
  const commandGroups = new Set();
  let token;
  let interruption;
  let interrupt;
  const abort = new AbortController();
  const assertNotInterrupted = () => abort.signal.throwIfAborted();
  const errorText = (error) => {
    const raw = error instanceof Error ? error.message : String(error);
    return token ? raw.replaceAll(token, "[redacted-token]") : raw;
  };
  const commandGroupAlive = (groupId) => {
    try { process.kill(-groupId, 0); return true; }
    catch (error) { if (error.code === "ESRCH") return false; if (error.code === "EPERM") return true; throw error; }
  };
  const waitGroupGone = async (groupId, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (commandGroupAlive(groupId) && Date.now() < deadline) await sleep(100);
    return !commandGroupAlive(groupId);
  };
  const signalGroup = (groupId, signal) => {
    try { process.kill(-groupId, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const ensureGroupStopped = async (groupId, urgent = false) => {
    if (!groupId) return;
    const evidence = report.commandRuns.find((item) => item.pgid === groupId);
    const confirmed = () => {
      commandGroups.delete(groupId);
      if (evidence) evidence.groupGoneConfirmed = true;
    };
    if (!urgent && await waitGroupGone(groupId, 1_000)) { confirmed(); return; }
    if (commandGroupAlive(groupId)) {
      signalGroup(groupId, "SIGTERM");
      if (evidence) evidence.sigtermSent = true;
    }
    if (await waitGroupGone(groupId, 5_000)) { confirmed(); return; }
    signalGroup(groupId, "SIGKILL");
    if (evidence) evidence.sigkillSent = true;
    if (await waitGroupGone(groupId, 5_000)) { confirmed(); return; }
    throw new Error(`build, pack, or install process group ${groupId} remained after SIGKILL`);
  };
  const stopCommand = async () => {
    await Promise.all([...commandGroups].map((groupId) => ensureGroupStopped(groupId, true)));
    if (commandGroups.size) throw new Error("build, pack, or install process group cleanup was not confirmed");
  };
  const requestCommandShutdown = () => {
    commandShutdown ??= stopCommand();
    return commandShutdown;
  };
  const runOwnedCommand = async (bin, args, options = {}) => {
    assertNotInterrupted();
    const injectHold = options.stage && process.argv.includes(`--hold-during-${options.stage}`);
    const injectOrphan = options.stage && process.argv.includes(`--orphan-during-${options.stage}`);
    const launchBin = injectHold || injectOrphan ? "/bin/sh" : bin;
    const launchArgs = injectHold ? ["-c", `sleep 3600 & echo HOLD_DURING_${options.stage.toUpperCase()}; wait`] :
      injectOrphan ? ["-c", `sleep 3600 & echo ORPHAN_DURING_${options.stage.toUpperCase()}; exit 23`] : args;
    const child = spawn(launchBin, launchArgs, { cwd: options.cwd ?? root, env: options.env ?? process.env,
      stdio: "inherit", detached: true });
    commandChild = child;
    if (child.pid) {
      commandGroups.add(child.pid);
      report.commandRuns.push({ stage: options.stage ?? "command", pgid: child.pid,
        injectedHold: Boolean(injectHold), injectedOrphan: Boolean(injectOrphan), groupGoneConfirmed: false });
    }
    try {
      const exit = await new Promise((done, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => done({ code, signal }));
      });
      await ensureGroupStopped(child.pid);
      assertNotInterrupted();
      if (exit.code !== 0) throw new Error(`${bin} ${args.slice(0, 3).join(" ")} exited ${exit.code ?? exit.signal}`);
    } finally {
      if (commandChild === child) commandChild = undefined;
    }
  };
  const interrupted = new Promise((_, reject) => { interrupt = reject; });
  const signalHandler = (signal) => {
    if (interruption) return;
    interruption = signal;
    abort.abort(new Error(`Interrupted by ${signal}`));
    // Build/pack/install may still be running after the outer interrupt race settles.
    void requestCommandShutdown().catch(() => {});
    interrupt(new Error(`Interrupted by ${signal}`));
  };
  const onSigint = () => signalHandler("SIGINT");
  const onSigterm = () => signalHandler("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  let exitCode = 1;
  try {
    await Promise.race([(async () => {
      const selectedCli = cliScript(process.env.OPENCLAW_BIN ?? join(root, "node_modules/.bin/openclaw"));
      const version = execFileSync(process.execPath, [selectedCli, "--version"], { encoding: "utf8" }).trim();
      if (!/\b2026\.9\.6\b/.test(version)) throw new Error(`OpenClaw 2026.9.6 required, got ${version}`);
      if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);
      stateDir = mkdtempSync(join(tmpdir(), "openclaw-u3-browser-e2e-"));
      for (const [id, dir] of [["router", routerDir], ["tracing", tracingDir]]) {
        await runOwnedCommand("pnpm", ["--dir", dir, "build"], { stage: "build" });
        report.build[id] = buildEvidence(dir);
      }
      assertNotInterrupted();
      let loadedRouterDir = routerDir;
      let loadedTracingDir = tracingDir;
      if (installedCandidate) {
        const packRoot = join(stateDir, "packs");
        for (const [id, dir] of [["router", routerDir], ["tracing", tracingDir]]) {
          const packDir = join(packRoot, id);
          mkdirSync(packDir, { recursive: true, mode: 0o700 });
          await runOwnedCommand("pnpm", ["pack", "--pack-destination", packDir], { cwd: dir, stage: "pack" });
          const archives = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
          if (archives.length !== 1) throw new Error(`${id}: pnpm pack produced ${archives.length} archives`);
          const archivePath = join(packDir, archives[0]);
          const retainedTarballPath = join(outputDir, `${id}-${archives[0]}`);
          copyFileSync(archivePath, retainedTarballPath);
          chmodSync(retainedTarballPath, 0o600);
          const tarballSha256 = sha256File(archivePath);
          if (sha256File(retainedTarballPath) !== tarballSha256) throw new Error(`${id}: retained tarball hash mismatch`);
          const installedPath = join(stateDir, "extensions", `${id}-candidate`);
          const packedContentSha256 = preparePackedCandidate(archivePath, installedPath);
          assertCleanPackedArtifact(installedPath);
          const identity = assertInstalledIdentity(id, dir, installedPath, packedContentSha256);
          const reviewedArgs = trustedE2ELinkArgs(`extensions/${id}`, installedPath, root, stateDir, id);
          if (reviewedArgs[0] !== "--profile" || reviewedArgs[1] !== "queue-e2e" ||
              reviewedArgs.at(-1) !== realpathSync(installedPath) || !reviewedArgs.includes("--accept-capabilities")) {
            throw new Error(`${id}: reviewed install argument shape changed`);
          }
          report.candidates.push({ id, sourcePath: dir, packedPath: archivePath,
            retainedTarballPath, tarballSha256, installedPath, ...identity,
            reviewedCapabilityConsent: true });
        }
        if (process.argv.includes("--hold-after-pack")) {
          console.log("[u3-browser] HOLD_AFTER_PACK");
          await sleep(3_600_000, undefined, { signal: abort.signal });
        }
        loadedRouterDir = report.candidates.find((candidate) => candidate.id === "router").installedPath;
        loadedTracingDir = report.candidates.find((candidate) => candidate.id === "tracing").installedPath;
      }
      token = randomBytes(32).toString("hex");
      const port = await unusedPort();
      assertNotInterrupted();
      const origin = `http://127.0.0.1:${port}`;
      const profile = `u3-browser-${randomBytes(6).toString("hex")}`;
      const configPath = writeDisposableConfig({ stateDir, fixtureDir, routerDir: loadedRouterDir,
        tracingDir: loadedTracingDir, port, token });
      syntheticModel(configPath);
      if (installedCandidate) {
        const configuredPaths = JSON.parse(readFileSync(configPath, "utf8")).plugins.load.paths;
        if (configuredPaths.includes(routerDir) || configuredPaths.includes(tracingDir) ||
            !configuredPaths.includes(loadedRouterDir) || !configuredPaths.includes(loadedTracingDir)) {
          throw new Error("installed candidate config referenced source or omitted installed paths");
        }
        report.configuredPluginPaths = configuredPaths;
        for (const candidate of report.candidates) {
          const reviewedArgs = trustedE2ELinkArgs(`extensions/${candidate.id}`, candidate.installedPath,
            root, stateDir, candidate.id);
          await runOwnedCommand(process.execPath, [selectedCli, "--profile", profile, ...reviewedArgs.slice(2)], {
            env: { ...process.env, HOME: stateDir, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath },
            stage: "install",
          });
          if (reviewedArtifactDigest(candidate.installedPath) !== candidate.artifactSha256) {
            throw new Error(`${candidate.id}: installed package changed during registration`);
          }
          candidate.registeredWithOpenClaw = true;
        }
      }
      const logFd = openSync(join(stateDir, "gateway.log"), "w", 0o600);
      try {
        assertNotInterrupted();
        gateway = spawn(process.execPath, [selectedCli, "--profile", profile, "gateway", "run", "--allow-unconfigured", "--port", String(port)], {
          env: { ...process.env, HOME: stateDir, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath },
          stdio: ["ignore", logFd, logFd],
        });
        gateway.on("error", (error) => { gateway.spawnError = error; });
      } finally { closeSync(logFd); }
      console.log("[u3-browser] GATEWAY_SPAWNED");
      await waitReady(origin, gateway, abort.signal);
      assertNotInterrupted();
      const { chromium } = await import("playwright");
      assertNotInterrupted();
      const chromePort = await unusedPort();
      assertNotInterrupted();
      if (process.argv.includes("--hold-before-chrome-spawn")) {
        console.log("[u3-browser] HOLD_BEFORE_CHROME_SPAWN");
        await sleep(3_600_000, undefined, { signal: abort.signal });
      }
      const chromeLogFd = openSync(join(stateDir, "chrome.log"), "w", 0o600);
      try {
        assertNotInterrupted();
        chromeChild = spawn(chromePath, ["--headless=new", "--no-first-run", "--no-default-browser-check",
          "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${chromePort}`,
          `--user-data-dir=${join(stateDir, "chrome-profile")}`, "about:blank"], {
          stdio: ["ignore", chromeLogFd, chromeLogFd],
        });
        chromeChild.on("error", (error) => { chromeChild.spawnError = error; });
      } finally { closeSync(chromeLogFd); }
      const cdpOrigin = await waitChromeCdp(chromePort, chromeChild, abort.signal);
      assertNotInterrupted();
      browser = await chromium.connectOverCDP(cdpOrigin);
      assertNotInterrupted();
      for (const view of views) {
        assertNotInterrupted();
        const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: 1 });
        try {
          assertNotInterrupted();
          const page = await context.newPage();
          assertNotInterrupted();
          await page.goto(`${origin}/chat#token=${token}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
          assertNotInterrupted();
          await page.waitForURL((url) => !url.hash.includes("token="), { timeout: 15_000 });
          assertNotInterrupted();
          await page.getByText("Router status", { exact: true }).waitFor({ state: "attached", timeout: 30_000 });
          const entry = { viewport: view, tabs: [] };
          report.evidence.push(entry);
          try {
            for (const tab of tabs) {
              assertNotInterrupted();
              entry.tabs.push(await inspectTab(page, origin, view, tab, outputDir));
              if (view.name === "mobile" && tab.name === "router" && process.argv.includes("--hold-after-mobile-router")) {
                console.log("[u3-browser] HOLD_AFTER_MOBILE_ROUTER");
                await sleep(3_600_000, undefined, { signal: abort.signal });
              }
            }
          } catch (error) {
            await page.screenshot({ path: join(outputDir, `${view.name}-failure.png`) }).catch(() => {});
            throw error;
          }
        } finally { await context.close(); }
      }
    })(), interrupted]);
    if (!interruption) report.status = "PASS";
  } catch (error) {
    report.status = interruption ? "INTERRUPTED" : "FAIL";
    report.error = errorText(error);
    console.error(`[u3-browser] ${report.status}: ${report.error}`);
  } finally {
    // Cleanup is driven by the signal race, so a stalled browser action cannot delay it.
    try { await requestCommandShutdown(); report.cleanup.commandStopped = true; }
    catch (error) { report.cleanup.commandError = errorText(error); }
    if (browser) {
      try { await Promise.race([browser.close(), sleep(5_000).then(() => { throw new Error("Chrome close timeout"); })]); }
      catch (error) {
        report.cleanup.chromeCloseError = errorText(error);
        if (!interruption) {
          report.status = "FAIL";
          report.error = report.cleanup.chromeCloseError;
        }
      }
    }
    try { await stopChild(chromeChild, "Chrome"); report.cleanup.chromeStopped = true; }
    catch (error) { report.cleanup.chromeError = errorText(error); }
    try {
      await stopChild(gateway, "Gateway");
      report.cleanup.gatewayStopped = true;
    } catch (error) { report.cleanup.gatewayError = errorText(error); }
    if (stateDir && report.cleanup.commandStopped && report.cleanup.gatewayStopped && report.cleanup.chromeStopped) {
      try { rmSync(stateDir, { recursive: true }); report.cleanup.tempStateRemoved = !existsSync(stateDir); }
      catch (error) { report.cleanup.tempStateError = errorText(error); }
    }
    for (const candidate of report.candidates) {
      candidate.packedPathRemovedAfterRun = report.cleanup.tempStateRemoved === true && !existsSync(candidate.packedPath);
      candidate.installedPathRemovedAfterRun = report.cleanup.tempStateRemoved === true && !existsSync(candidate.installedPath);
      candidate.retainedTarballVerified = existsSync(candidate.retainedTarballPath) &&
        sha256File(candidate.retainedTarballPath) === candidate.tarballSha256;
    }
    if (installedCandidate && report.candidates.some((candidate) => !candidate.retainedTarballVerified ||
        !candidate.packedPathRemovedAfterRun || !candidate.installedPathRemovedAfterRun)) {
      report.status = "FAIL";
      report.error = `${report.error ?? "Browser checks completed"}; candidate archive or temporary path verification failed`;
    }
    if (report.cleanup.commandStopped !== true || report.cleanup.chromeStopped !== true || report.cleanup.gatewayStopped !== true ||
        (stateDir && report.cleanup.tempStateRemoved !== true)) {
      report.status = "FAIL";
      report.error = `${report.error ?? "Browser checks completed"}; owned process or temporary state cleanup failed`;
    }
    if (interruption && report.status === "PASS") {
      report.status = "INTERRUPTED";
      report.error = `Interrupted by ${interruption}`;
    }
    report.finishedAt = new Date().toISOString();
    writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
    console.log(`[u3-browser] ${report.status} report: ${reportPath}`);
    exitCode = report.status === "PASS" ? 0 : interruption === "SIGINT" && report.status === "INTERRUPTED" ? 130 :
      interruption === "SIGTERM" && report.status === "INTERRUPTED" ? 143 : 1;
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
  // Force a deterministic exit after the report; a cancelled Playwright action may still own a promise.
  process.exit(exitCode);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
