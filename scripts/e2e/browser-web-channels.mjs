/**
 * Browser automation for test-web UI against installed web-mqtt / web-stomp gateways.
 * Uses Playwright when available; falls back to Node WebSocket smoke (see test-installed-plugins).
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_DIR, REPO_ROOT, waitFor, tcpReachable, E2E_PORTS } from "./lib/utils.mjs";

const TEST_WEB_PORT = Number(process.env.E2E_TEST_WEB_PORT ?? 8765);
const TEST_WEB_URL = `http://127.0.0.1:${TEST_WEB_PORT}`;

/** @type {{ plugin: string; result: string; evidence: string; blocker?: string }[]} */
export const browserResults = [];

/**
 * @param {string} plugin
 * @param {() => Promise<string>} fn
 */
async function runBrowser(plugin, fn) {
  try {
    const evidence = await fn();
    browserResults.push({ plugin, result: "PASS", evidence });
  } catch (err) {
    browserResults.push({
      plugin,
      result: "FAIL",
      evidence: "",
      blocker: err instanceof Error ? err.message : String(err),
    });
  }
}

function startTestWebServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, "test-web/serve.mjs"), String(TEST_WEB_PORT)], {
      cwd: join(REPO_ROOT, "test-web"),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false;
    child.on("error", reject);
    child.stdout.on("data", (buf) => {
      const s = buf.toString();
      if (s.includes("listening") || s.includes(String(TEST_WEB_PORT))) {
        ready = true;
        resolve(child);
      }
    });
    child.stderr.on("data", (buf) => process.stderr.write(buf));
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`test-web exited early: ${code}`));
    });
    setTimeout(() => {
      if (!ready) resolve(child);
    }, 2000);
  });
}

export async function runBrowserTests() {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    browserResults.push({
      plugin: "web-mqtt/web-stomp",
      result: "SKIP",
      evidence: "playwright not installed; CLI WS tests cover web channels",
      blocker: "optional playwright missing",
    });
    return;
  }

  const server = await startTestWebServer();
  await waitFor(() => tcpReachable(TEST_WEB_PORT), { label: "test-web server", timeoutMs: 10_000 });

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Patch default URLs to E2E ports
  await page.goto(TEST_WEB_URL);
  await page.evaluate(
    ({ stompPort, mqttPort }) => {
      document.getElementById("stomp-url").value = `ws://127.0.0.1:${stompPort}/ws`;
      document.getElementById("mqtt-url").value = `ws://127.0.0.1:${mqttPort}/ws`;
    },
    { stompPort: E2E_PORTS.webStompWs, mqttPort: E2E_PORTS.webMqttWs },
  );

  await runBrowser("web-stomp", async () => {
    await page.click("#stomp-connect");
    await page.waitForFunction(
      () => document.getElementById("stomp-status")?.classList.contains("ok"),
      { timeout: 15_000 },
    );
    await page.click("#stomp-subscribe");
    await page.click("#stomp-send");
    const log = await page.locator("#stomp-log").innerText();
    writeFileSync(join(E2E_DIR, ".browser-stomp.log"), log);
    return "stomp-status ok; log saved to .browser-stomp.log";
  });

  await runBrowser("web-mqtt", async () => {
    await page.click("#mqtt-connect");
    await page.waitForFunction(
      () => document.getElementById("mqtt-status")?.classList.contains("ok"),
      { timeout: 15_000 },
    );
    await page.click("#mqtt-subscribe");
    await page.click("#mqtt-publish");
    const log = await page.locator("#mqtt-log").innerText();
    writeFileSync(join(E2E_DIR, ".browser-mqtt.log"), log);
    return "mqtt-status ok; log saved to .browser-mqtt.log";
  });

  await browser.close();
  server.kill("SIGTERM");
}
