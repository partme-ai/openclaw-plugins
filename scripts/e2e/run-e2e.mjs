#!/usr/bin/env node
/**
 * OpenClaw plugin E2E orchestrator.
 *
 * Usage:
 *   node scripts/e2e/run-e2e.mjs
 *   node scripts/e2e/run-e2e.mjs --plugins mqtt,rabbitmq
 *   node scripts/e2e/run-e2e.mjs --keep-services
 *   OPENCLAW_E2E_HOST_GATEWAY=1 node scripts/e2e/run-e2e.mjs
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bootstrapGotify } from "./bootstrap/gotify.mjs";
import { bootstrapRocketmqTopic } from "./bootstrap/rocketmq-topic.mjs";
import { bootstrapNacosConfig } from "./bootstrap/nacos-config.mjs";
import {
  composeDown,
  composeUp,
  dockerPs,
  DOCKER,
  gatewayMode,
  useHostGateway,
} from "./lib/compose.mjs";
import { generateOpenClawConfig } from "./lib/config.mjs";
import { sourceFingerprint } from "./lib/evidence.mjs";
import { startOpenAiModelFixture } from "./helpers/openai-model-fixture.mjs";
import { startOpenMemSidecar } from "./helpers/openmem-sidecar.mjs";
import { startAmapProvider } from "./helpers/amap-provider.mjs";
import { startMeituanProvider } from "./helpers/meituan-provider.mjs";
import { startRednodeProvider } from "./helpers/rednode-provider.mjs";
import { startWechatProvider } from "./helpers/wechat-provider.mjs";
import { startWechatIpadProvider } from "./helpers/wechat-ipad-provider.mjs";
import { startWecomKfProvider } from "./helpers/wecom-kf-provider.mjs";
import { startWecomProvider } from "./helpers/wecom-provider.mjs";
import { prepareWechatState } from "./helpers/wechat-state.mjs";
import { ensureGatewayRunning, gatewayLogTail, stopHostGateway } from "./lib/gateway.mjs";
import { installPlugins } from "./lib/install.mjs";
import { dockerServicesForPlugins, resolvePlugins } from "./lib/registry.mjs";
import { baseReport, printSummary, writeReport } from "./lib/report.mjs";
import {
  E2E_DIR,
  E2E_PORTS,
  GATEWAY_HTTP,
  OPENCLAW_BIN,
  PROFILE,
  REPO_ROOT,
  resetE2EProfile,
  tcpReachable,
  waitFor,
} from "./lib/utils.mjs";
import { runBrowserTests, runPluginTests } from "./plugins/index.mjs";

let activeModelFixture = null;
let activeOpenMemSidecar = null;
let activeAmapProvider = null;
let activeMeituanProvider = null;
let activeRednodeProvider = null;
let activeWechatProvider = null;
let activeWechatIpadProvider = null;
let activeWecomKfProvider = null;
let activeWecomProvider = null;

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ plugins?: string[]; keepServices: boolean; skipBrowser: boolean; skipInstall: boolean; help: boolean }} */
  const opts = {
    keepServices: false,
    skipBrowser: false,
    skipInstall: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--keep-services") opts.keepServices = true;
    else if (arg === "--skip-browser") opts.skipBrowser = true;
    else if (arg === "--skip-install") opts.skipInstall = true;
    else if (arg === "--plugins") {
      const val = argv[++i];
      opts.plugins = val.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith("--plugins=")) {
      opts.plugins = arg.slice("--plugins=".length).split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return opts;
}

/** Wait for Docker health on backing services used by selected plugins. */
async function waitDockerHealthy(pluginIds) {
  const services = dockerServicesForPlugins(pluginIds);
  if (services.includes("rabbitmq")) {
    await waitFor(
      () => {
        try {
          const out = execSync(`${DOCKER} inspect -f '{{.State.Health.Status}}' openclaw-e2e-rabbitmq`, {
            encoding: "utf8",
          }).trim();
          return out === "healthy";
        } catch {
          return false;
        }
      },
      { label: "rabbitmq healthy", timeoutMs: 120_000 },
    );
  }
  if (services.includes("gotify")) {
    await waitFor(
      () => {
        try {
          const out = execSync(`${DOCKER} inspect -f '{{.State.Health.Status}}' openclaw-e2e-gotify`, {
            encoding: "utf8",
          }).trim();
          return out === "healthy";
        } catch {
          return false;
        }
      },
      { label: "gotify healthy", timeoutMs: 120_000 },
    );
  }
  if (services.includes("otel-collector")) {
    await waitFor(() => tcpReachable(14318), {
      label: "OpenTelemetry Collector OTLP/HTTP 14318",
      timeoutMs: 120_000,
    });
  }
  if (services.includes("nacos")) {
    await waitFor(() => tcpReachable(E2E_PORTS.nacosHttp), {
      label: `Nacos HTTP ${E2E_PORTS.nacosHttp}`,
      timeoutMs: 180_000,
    });
    await waitFor(
      async () => {
        try {
          await bootstrapNacosConfig();
          return true;
        } catch {
          return false;
        }
      },
      { label: "Nacos Config API ready", timeoutMs: 180_000, intervalMs: 1_000 },
    );
  }
  if (services.some((s) => s.startsWith("rocketmq"))) {
    try {
      await waitFor(() => tcpReachable(8081), { label: "rocketmq proxy 8081", timeoutMs: 180_000 });
    } catch (err) {
      console.warn("[rocketmq] proxy not healthy:", err.message);
    }
  }
}

function printHelp() {
  console.log(`OpenClaw plugin E2E orchestrator

Usage:
  node scripts/e2e/run-e2e.mjs [options]

Options:
  --plugins mqtt,rabbitmq   Subset of registered E2E adapters (default: all)
  --keep-services           Do not docker compose down after run
  --skip-browser            Skip Playwright browser tests
  --skip-install            Skip build/pack/install (reuse prior install)
  --help                    Show this help

Unit/E2E selection (prefer pnpm test:unit / pnpm test:e2e):
  node scripts/test-plugins.mjs --unit-only [--plugins ...]
  node scripts/test-plugins.mjs --e2e-only [--plugins ...] [e2e options above]

Environment:
  OPENCLAW_E2E_HOST_GATEWAY=1   Run gateway on host instead of Docker openclaw service
  OPENCLAW_BIN                  Path to openclaw CLI (host mode)
  E2E_GATEWAY_PORT              Gateway port (default 19789)
  OPENCLAW_E2E_PRESERVE_STATE=1 Reuse the dedicated E2E profile instead of resetting it
`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const pluginIds = resolvePlugins(opts.plugins);
  const needsModelFixture = pluginIds.some((id) =>
    id === "mqtt" || id === "tracing" || id === "rabbitmq" || id === "redis-stream" || id === "rocketmq" || id === "gotify" || id === "stomp" || id === "web-stomp" || id === "web-mqtt" || id === "web-socket" || id === "memory" || id === "openmem" || id === "knowledge" || id === "douyin" || id === "amap" || id === "meituan" || id === "rednode" || id === "wechat" || id === "wechat-ipad" || id === "wecom" || id === "wecom-kf" || id === "bridge"
  );
  if ((needsModelFixture || pluginIds.some((id) => id === "oauth2" || id === "web-socket" || id === "openmem")) && !useHostGateway()) {
    process.env.OPENCLAW_E2E_HOST_GATEWAY = "1";
    console.log(`[${pluginIds[0]}] using host Gateway for a host-reachable local fixture`);
  }
  const backingServices = dockerServicesForPlugins(pluginIds);
  const needsBackingDocker = backingServices.length > 0;
  const needsOpenClawContainer = !useHostGateway();
  const needsDocker = needsBackingDocker || needsOpenClawContainer;

  const report = baseReport({
    plugins: pluginIds,
    gatewayMode: gatewayMode(),
    docker: {},
    e2e: [],
    browser: [],
    commits: execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim(),
    // 指纹绑定“本次打包实测的源码”和报告，避免工作区变化后继续复用历史 PASS。
    sourceFingerprints: Object.fromEntries(
      pluginIds.map((id) => [id, sourceFingerprint(id)]),
    ),
  });

  console.log("=== OpenClaw Plugin E2E ===");
  console.log("plugins:", pluginIds.join(", "));
  console.log("gateway mode:", report.gatewayMode);

  if (!opts.skipInstall) {
    stopHostGateway();
    resetE2EProfile();
  }

  if (needsDocker) {
    const services = backingServices;
    report.docker = composeUp(services, { includeOpenClaw: needsOpenClawContainer });
    if (report.docker.ok) {
      await waitDockerHealthy(pluginIds);
      if (pluginIds.includes("gotify")) {
        report.gotify = await bootstrapGotify();
      }
    } else {
      console.warn("[docker] BLOCKED:", report.docker.blocker);
      if (backingServices.length) {
        console.warn("[docker] External broker tests (rabbitmq, rocketmq, gotify) will likely FAIL without Docker.");
      }
    }
  }

  if (!opts.skipInstall) {
    // `plugins install --link` loads and validates the candidate manifest
    // immediately. Seed the complete plugin/channel fragment first so plugins
    // with required config fields (for example RabbitMQ `url`) can be linked
    // into a freshly reset profile. The config is regenerated after install to
    // add the newly packed paths to `plugins.load.paths`.
    generateOpenClawConfig(pluginIds, {
      gotifySecrets: report.gotify,
      installSeed: true,
    });
    report.installed = installPlugins(pluginIds);
  }

  if (report.docker?.ok || pluginIds.some((id) => ["mqtt", "stomp", "web-mqtt", "web-stomp", "web-socket", "mtls", "oauth2", "tracing", "prometheus", "memory", "openmem", "knowledge", "douyin", "amap", "meituan", "rednode", "wechat", "wechat-ipad", "wecom", "wecom-kf", "bridge", "nacos"].includes(id))) {
    if (pluginIds.includes("gotify") && !report.gotify) {
      const secretsPath = join(E2E_DIR, ".e2e-secrets.json");
      if (existsSync(secretsPath)) {
        report.gotify = JSON.parse(readFileSync(secretsPath, "utf8"));
      }
    }
    report.config = generateOpenClawConfig(pluginIds, { gotifySecrets: report.gotify });
    if (pluginIds.includes("wechat")) prepareWechatState();
    if (pluginIds.includes("rocketmq") && report.docker?.ok) {
      await bootstrapRocketmqTopic(report.config.meta.rocketmqTopic);
    }
  }

  const modelFixture = needsModelFixture
    ? await startOpenAiModelFixture(E2E_PORTS.modelFixture)
    : null;
  activeModelFixture = modelFixture;
  const openmemSidecar = pluginIds.includes("openmem")
    ? await startOpenMemSidecar()
    : null;
  activeOpenMemSidecar = openmemSidecar;
  const amapProvider = pluginIds.includes("amap")
    ? await startAmapProvider(E2E_PORTS.amapProvider)
    : null;
  activeAmapProvider = amapProvider;
  const meituanProvider = pluginIds.includes("meituan")
    ? await startMeituanProvider(E2E_PORTS.meituanProvider)
    : null;
  activeMeituanProvider = meituanProvider;
  const rednodeProvider = pluginIds.includes("rednode")
    ? await startRednodeProvider(E2E_PORTS.rednodeProvider)
    : null;
  activeRednodeProvider = rednodeProvider;
  const wechatProvider = pluginIds.includes("wechat")
    ? await startWechatProvider(E2E_PORTS.wechatProvider)
    : null;
  activeWechatProvider = wechatProvider;
  const wechatIpadProvider = pluginIds.includes("wechat-ipad")
    ? await startWechatIpadProvider(E2E_PORTS.wechatIpadProvider)
    : null;
  activeWechatIpadProvider = wechatIpadProvider;
  const wecomKfProvider = pluginIds.includes("wecom-kf")
    ? await startWecomKfProvider(E2E_PORTS.wecomKfProvider)
    : null;
  activeWecomKfProvider = wecomKfProvider;
  const wecomProvider = pluginIds.includes("wecom")
    ? await startWecomProvider(E2E_PORTS.wecomProvider)
    : null;
  activeWecomProvider = wecomProvider;

  report.gateway = await ensureGatewayRunning();

  report.e2e = await runPluginTests(pluginIds, { modelFixture, openmemSidecar, amapProvider, meituanProvider, rednodeProvider, wechatProvider, wechatIpadProvider, wecomKfProvider, wecomProvider });

  if (!opts.skipBrowser && pluginIds.some((id) => id === "web-mqtt" || id === "web-stomp" || id === "web-socket")) {
    await runBrowserTests(pluginIds);
    const { browserResults } = await import("./browser-web-channels.mjs");
    report.browser = browserResults;
  }
  await modelFixture?.close();
  activeModelFixture = null;
  await openmemSidecar?.close();
  activeOpenMemSidecar = null;
  await amapProvider?.close();
  activeAmapProvider = null;
  await meituanProvider?.close();
  activeMeituanProvider = null;
  await rednodeProvider?.close();
  activeRednodeProvider = null;
  await wechatProvider?.close();
  activeWechatProvider = null;
  await wechatIpadProvider?.close();
  activeWechatIpadProvider = null;
  await wecomKfProvider?.close();
  activeWecomKfProvider = null;
  await wecomProvider?.close();
  activeWecomProvider = null;

  try {
    report.pluginsList = execSync(`${OPENCLAW_BIN} --profile ${PROFILE} plugins list`, { encoding: "utf8" });
  } catch (err) {
    report.pluginsList = String(err);
  }

  report.dockerPs = dockerPs();
  report.gatewayLogTail = gatewayLogTail();
  report.serviceUrls = {
    gateway: GATEWAY_HTTP,
    rabbitmq: "amqp://127.0.0.1:5672",
    gotify: "http://127.0.0.1:18080",
    rocketmqProxy: "127.0.0.1:8081",
    nacos: `http://127.0.0.1:${E2E_PORTS.nacosHttp}/nacos`,
  };

  const reportPath = writeReport(report);
  report.reportPath = reportPath;
  printSummary(report);

  if (!opts.keepServices) {
    stopHostGateway();
    composeDown(false);
  }

  const failed = [...report.e2e, ...report.browser].filter((r) => r.result === "FAIL").length;
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  await activeModelFixture?.close().catch(() => {});
  await activeOpenMemSidecar?.close().catch(() => {});
  await activeAmapProvider?.close().catch(() => {});
  await activeMeituanProvider?.close().catch(() => {});
  await activeRednodeProvider?.close().catch(() => {});
  await activeWechatProvider?.close().catch(() => {});
    await activeWechatIpadProvider?.close().catch(() => {});
    await activeWecomKfProvider?.close().catch(() => {});
    await activeWecomProvider?.close().catch(() => {});
  if (!process.argv.includes("--keep-services")) {
    try {
      stopHostGateway();
      composeDown(false);
    } catch (cleanupError) {
      console.error("[cleanup] docker compose down failed:", cleanupError);
    }
  }
  process.exit(1);
});
