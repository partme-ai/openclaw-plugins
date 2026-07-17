/**
 * Browser automation for installed web-mqtt / web-stomp / web-socket gateways.
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

/** @param {string[]} selectedPlugins */
export async function runBrowserTests(selectedPlugins = ["web-mqtt", "web-stomp", "web-socket"]) {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    browserResults.push({
      plugin: "web-mqtt/web-stomp/web-socket",
      result: "SKIP",
      evidence: "playwright not installed; CLI WS tests cover web channels",
      blocker: "optional playwright missing",
    });
    return;
  }

  const server = await startTestWebServer();
  let browser;
  try {
    await waitFor(() => tcpReachable(TEST_WEB_PORT), { label: "test-web server", timeoutMs: 10_000 });

    browser = await playwright.chromium.launch({ headless: true });
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

    if (selectedPlugins.includes("web-stomp")) await runBrowser("web-stomp", async () => {
      await page.fill("#stomp-login", "web-stomp-e2e");
      await page.fill("#stomp-passcode", "web-stomp-e2e-secret");
      await page.fill("#stomp-send-dest", "/queue/agent.main");
      await page.fill("#stomp-body", JSON.stringify({
        text: "Return the Web-STOMP browser E2E fixture response.",
        idempotencyKey: `web-stomp-browser-${Date.now()}`,
      }));
      await page.click("#stomp-connect");
      await page.waitForFunction(
        () => document.getElementById("stomp-status")?.classList.contains("ok"),
        undefined,
        { timeout: 15_000 },
      );
      await page.click("#stomp-subscribe");
      await page.waitForFunction(
        () => document.getElementById("stomp-log")?.textContent?.includes(">> SUBSCRIBE /topic/session.stomp:"),
        undefined,
        { timeout: 10_000 },
      );
      await page.click("#stomp-send");
      await page.waitForFunction(
        () => document.getElementById("stomp-log")?.textContent?.includes("openclaw e2e fixture reply"),
        undefined,
        { timeout: 45_000 },
      );
      const log = await page.locator("#stomp-log").innerText();
      writeFileSync(join(E2E_DIR, ".browser-stomp.log"), log);
      return "Chromium STOMP auth/connect/subscribe/send/Agent reply passed; log saved to .browser-stomp.log";
    });

    if (selectedPlugins.includes("web-mqtt")) await runBrowser("web-mqtt", async () => {
      await page.fill("#mqtt-username", "web-mqtt-e2e");
      await page.fill("#mqtt-password", "web-mqtt-e2e-secret");
      await page.fill("#mqtt-sub-topic", "openclaw/agent/main/out");
      await page.fill("#mqtt-pub-topic", "openclaw/agent/main/in");
      await page.fill("#mqtt-body", JSON.stringify({
        text: "Return the Web-MQTT browser E2E fixture response.",
        idempotencyKey: `web-mqtt-browser-${Date.now()}`,
      }));
      await page.click("#mqtt-connect");
      try {
        await page.waitForFunction(
          () => document.getElementById("mqtt-status")?.classList.contains("ok"),
          undefined,
          { timeout: 15_000 },
        );
      } catch (error) {
        const status = await page.locator("#mqtt-status").innerText();
        const log = await page.locator("#mqtt-log").innerText();
        writeFileSync(join(E2E_DIR, ".browser-mqtt.log"), log);
        throw new Error(
          `MQTT browser connect failed (status=${JSON.stringify(status)}, log=${JSON.stringify(log)}): ${error instanceof Error ? error.message : error}`,
        );
      }
      await page.click("#mqtt-subscribe");
      await page.waitForFunction(
        () => document.getElementById("mqtt-log")?.textContent?.includes(">> SUB openclaw/agent/main/out"),
        undefined,
        { timeout: 10_000 },
      );
      await page.click("#mqtt-publish");
      await page.waitForFunction(
        () => document.getElementById("mqtt-log")?.textContent?.includes("openclaw e2e fixture reply"),
        undefined,
        { timeout: 45_000 },
      );
      const log = await page.locator("#mqtt-log").innerText();
      writeFileSync(join(E2E_DIR, ".browser-mqtt.log"), log);
      return "Chromium MQTT connect/subscribe/publish/Agent reply passed; log saved to .browser-mqtt.log";
    });

    if (selectedPlugins.includes("web-socket")) await runBrowser("web-socket", async () => {
      const evidence = await page.evaluate(async ({ port }) => {
        const token = "openclaw-web-socket-e2e-token";
        const bytes = new TextEncoder().encode(token);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
        const socket = new WebSocket(`ws://127.0.0.1:${port}/openclaw/ws`, [
          "openclaw.v1",
          `openclaw.auth.${encoded}`,
        ]);
        const frames = [];
        const waitForType = (type, timeoutMs = 45_000) => new Promise((resolve, reject) => {
          const existing = frames.find((frame) => frame.type === type);
          if (existing) return resolve(existing);
          const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs);
          const listener = (event) => {
            const frame = JSON.parse(event.data);
            frames.push(frame);
            if (frame.type !== type) return;
            clearTimeout(timer);
            socket.removeEventListener("message", listener);
            resolve(frame);
          };
          socket.addEventListener("message", listener);
        });
        const connectedPromise = waitForType("connected", 5_000);
        await new Promise((resolve, reject) => {
          socket.addEventListener("open", resolve, { once: true });
          socket.addEventListener("error", () => reject(new Error("browser WebSocket connection failed")), { once: true });
        });
        if (socket.protocol !== "openclaw.v1") throw new Error(`unexpected protocol: ${socket.protocol}`);
        const connected = await connectedPromise;
        const messageId = `web-socket-browser-${Date.now()}`;
        const replyPromise = waitForType("reply");
        const acceptedPromise = waitForType("accepted");
        socket.send(JSON.stringify({
          version: "1",
          type: "message",
          messageId,
          peerId: "browser-user",
          text: "Return the WebSocket browser E2E fixture response.",
        }));
        const [reply, accepted] = await Promise.all([replyPromise, acceptedPromise]);
        const negotiatedProtocol = socket.protocol;
        socket.close();
        const replyText = reply?.message?.text ?? reply?.text;
        if (replyText !== "openclaw e2e fixture reply") throw new Error(`unexpected reply: ${JSON.stringify(reply)}`);
        if (accepted.messageId !== messageId) throw new Error(`unexpected accepted: ${JSON.stringify(accepted)}`);
        return { protocol: negotiatedProtocol, connected, reply, accepted };
      }, { port: E2E_PORTS.webSocket });
      const log = JSON.stringify(evidence, null, 2);
      writeFileSync(join(E2E_DIR, ".browser-web-socket.log"), log);
      return "Chromium subprotocol auth/connect/versioned message/Agent reply/accepted passed; log saved to .browser-web-socket.log";
    });
  } finally {
    await browser?.close().catch(() => undefined);
    if (server.exitCode === null) server.kill("SIGTERM");
  }
}
