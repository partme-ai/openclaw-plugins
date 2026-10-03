/** Bridge tarball + MQTT：验证真实 Hook 事件被后台镜像到审计 Topic，并且不会自回环。 */
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { REPO_ROOT } from "../lib/utils.mjs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { OPENCLAW_BIN, PROFILE } from "../lib/utils.mjs";
import { runAdapterTest } from "./_context.mjs";

const req = createRequire(new URL("../../../extensions/mqtt/package.json", import.meta.url));
const mqtt = req("mqtt");

function gatewayCall(method, params = {}) {
  const output = execFileSync(OPENCLAW_BIN,
    ["--profile", PROFILE, "gateway", "call", method, "--params", JSON.stringify(params), "--json"],
    { encoding: "utf8", timeout: 30_000 });
  return JSON.parse(output);
}

function waitForTopics(client, topics, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const messages = new Map();
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Bridge topics: ${[...topics].filter((topic) => !messages.has(topic)).join(", ")}`));
    }, timeoutMs);
    timer.unref?.();
    const onMessage = (topic, payload) => {
      if (!topics.has(topic)) return;
      messages.set(topic, payload.toString("utf8"));
      if (messages.size === topics.size) {
        cleanup();
        resolve(messages);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      client.off("message", onMessage);
      client.off("error", onError);
    };
    client.on("message", onMessage);
    client.on("error", onError);
  });
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
export async function testBridge(ctx, results) {
  await runAdapterTest(
    ctx,
    "bridge",
    async () => {
      if (!ctx.pluginIds.includes("mqtt")) throw new Error("Bridge E2E requires --plugins bridge,mqtt");
      if (!ctx.modelFixture) throw new Error("Bridge E2E requires the local model fixture");
      const peerLink = join(ctx.installedPath('bridge'), 'node_modules/openclaw');
      if (!existsSync(peerLink)) {
        mkdirSync(dirname(peerLink), { recursive: true });
        symlinkSync(join(REPO_ROOT, 'node_modules/openclaw'), peerLink, 'dir');
      }
      const installed = await import(pathToFileURL(join(ctx.installedPath('bridge'), 'dist/index.js')).href);
      const mqttMeta = installed.getChannelMeta('mqtt');
      const availability = (plugins, status) => installed.resolveChannelAvailability(
        mqttMeta, installed.adaptGatewayChannelFacts(mqttMeta, plugins, status));
      const plugins = gatewayCall('plugins.list');
      const readAvailability = () => availability(plugins, gatewayCall('channels.status', { channel: 'mqtt' }));
      await ctx.waitFor(() => Promise.resolve(readAvailability().ready), { label: 'MQTT host readiness', timeoutMs: 30_000 });
      const initiallyReady = readAvailability();
      if (!initiallyReady.known || !initiallyReady.installed || !initiallyReady.enabled || !initiallyReady.ready) {
        throw Error(`Bridge host availability missing ready MQTT facts: ${JSON.stringify(initiallyReady)}`);
      }
      let budgetHook;
      const probeServices = [];
      installed.default.register({ registrationMode: 'full', pluginConfig: { contextMaxTokens: 1024, channels: { mqtt: { forwardToMq: false } } },
        logger: { info() {}, warn() {}, error() {} }, registerService(service) { probeServices.push(service); },
        on(name, hook) { if (name === 'before_prompt_build') budgetHook = hook; },
      });
      try {
        const probeStart = performance.now();
        const probe = await budgetHook({}, { channel: 'mqtt' });
        const injected = probe?.appendSystemContext ?? '';
        if (!injected.includes('[bridge:mqtt]') || Buffer.byteLength(injected) > 1024) throw Error('installed bridge budget/provenance failed');
        console.log(JSON.stringify({ o2: 'bridge', counter: 'utf8-byte-upper-bound-v1', tokens: Buffer.byteLength(injected), durationMs: performance.now() - probeStart }));
        if (await budgetHook({}, { channel: 'mqtt', hookInvocation: { assertActive() { throw Error('expired'); } } }) !== undefined) throw Error('installed bridge returned expired injection');
      } finally { await Promise.all(probeServices.map(service => service.stop?.())); }
      await ctx.waitFor(() => ctx.tcpReachable(11883), { label: "MQTT bridge target", timeoutMs: 30_000 });

      const inboundTopic = "openclaw/agent/main/in";
      const replyTopic = "openclaw/agent/main/out";
      const mirrorInbound = "openclaw/bridge/mqtt/inbound";
      const mirrorOutbound = "openclaw/bridge/mqtt/outbound";
      const expected = new Set([replyTopic, mirrorInbound, mirrorOutbound]);
      const client = mqtt.connect("mqtt://127.0.0.1:11883", {
        clientId: `bridge-e2e-${Date.now()}`,
        reconnectPeriod: 0,
        connectTimeout: 15_000,
        clean: true,
      });
      const auditCounts = new Map([[mirrorInbound, 0], [mirrorOutbound, 0]]);
      const countAuditMessage = (topic) => {
        if (auditCounts.has(topic)) auditCounts.set(topic, auditCounts.get(topic) + 1);
      };
      client.on("message", countAuditMessage);
      try {
        await new Promise((resolve, reject) => {
          client.once("connect", resolve);
          client.once("error", reject);
        });
        const granted = await client.subscribeAsync([...expected], { qos: 1 });
        if (granted.some((entry) => entry.qos !== 1)) {
          throw new Error(`Bridge MQTT subscription QoS mismatch: ${JSON.stringify(granted)}`);
        }
        const beforeCompletions = ctx.modelFixture.metrics.completions;
        const observed = waitForTopics(client, expected);
        await client.publishAsync(inboundTopic, JSON.stringify({
          ...ctx.pingPayload,
          text: "Return the Bridge E2E fixture response.",
          idempotencyKey: `bridge-turn-${Date.now()}`,
        }), { qos: 1, retain: false });
        const messages = await observed;
        const inbound = JSON.parse(messages.get(mirrorInbound));
        const outbound = JSON.parse(messages.get(mirrorOutbound));
        if (inbound.direction !== "inbound" || inbound.source?.channel !== "mqtt" || !inbound.messageId?.startsWith("bridge/in/mqtt/")) {
          throw new Error(`Invalid Bridge inbound mirror: ${messages.get(mirrorInbound)}`);
        }
        if (outbound.direction !== "outbound" || outbound.text !== "openclaw e2e fixture reply" || !outbound.messageId?.startsWith("bridge/out/mqtt/")) {
          throw new Error(`Invalid Bridge outbound mirror: ${messages.get(mirrorOutbound)}`);
        }
        if (ctx.modelFixture.metrics.completions - beforeCompletions !== 1) {
          throw new Error("Bridge source Agent Turn did not call the model exactly once");
        }
        // 审计消息本身也经 MQTT 出站；短暂观察后主题计数仍应各为 1，证明自回环闸门有效。
        await new Promise((resolve) => setTimeout(resolve, 250));
        if ([...auditCounts.values()].some((count) => count !== 1)) {
          throw new Error(`Bridge audit topic recursion detected: ${JSON.stringify(Object.fromEntries(auditCounts))}`);
        }
      } finally {
        client.off("message", countAuditMessage);
        client.end(true);
      }
      // The disposable Gateway emits the lifecycle facts. Restore even if the assertion fails.
      let stopped;
      try {
        gatewayCall('channels.stop', { channel: 'mqtt' });
        await ctx.waitFor(() => Promise.resolve(readAvailability().ready === false), { label: 'MQTT host stopped', timeoutMs: 30_000 });
        stopped = readAvailability();
        if (!stopped.installed || !stopped.enabled || stopped.ready || stopped.unavailableFacts?.includes('ready')) {
          throw Error(`MQTT stop did not report installed, enabled, and not ready: ${JSON.stringify(stopped)}`);
        }
      } finally {
        gatewayCall('channels.start', { channel: 'mqtt' });
      }
      await ctx.waitFor(() => Promise.resolve(readAvailability().ready), { label: 'MQTT host recovered', timeoutMs: 30_000 });
      const recovered = readAvailability();
      if (!recovered.installed || !recovered.enabled || !recovered.ready) {
        throw Error(`MQTT recovery did not restore host readiness: ${JSON.stringify(recovered)}`);
      }
      console.log(JSON.stringify({ o4: 'bridge-mqtt', initial: initiallyReady, stopped, recovered }));
    },
    {
      service: "Bridge + embedded MQTT:11883 + model fixture",
      method: "tarball hooks → bounded background delivery → inbound/outbound MQTT audit topics",
    },
    results,
  );
}
