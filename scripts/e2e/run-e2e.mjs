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
import {
  composeDown,
  composeUp,
  dockerPs,
  DOCKER,
  gatewayMode,
  useHostGateway,
} from "./lib/compose.mjs";
import { generateOpenClawConfig } from "./lib/config.mjs";
import { startOpenAiModelFixture } from "./helpers/openai-model-fixture.mjs";
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
    id === "tracing" || id === "rabbitmq" || id === "redis-stream" || id === "rocketmq" || id === "gotify" || id === "stomp" || id === "web-stomp" || id === "web-mqtt"
  );
  if ((needsModelFixture || pluginIds.some((id) => id === "oauth2" || id === "web-socket")) && !useHostGateway()) {
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
    generateOpenClawConfig(pluginIds, { gotifySecrets: report.gotify });
    report.installed = installPlugins(pluginIds);
  }

  if (report.docker?.ok || pluginIds.some((id) => ["mqtt", "stomp", "web-mqtt", "web-stomp", "web-socket", "mtls", "oauth2", "tracing"].includes(id))) {
    if (pluginIds.includes("gotify") && !report.gotify) {
      const secretsPath = join(E2E_DIR, ".e2e-secrets.json");
      if (existsSync(secretsPath)) {
        report.gotify = JSON.parse(readFileSync(secretsPath, "utf8"));
      }
    }
    report.config = generateOpenClawConfig(pluginIds, { gotifySecrets: report.gotify });
    if (pluginIds.includes("rocketmq") && report.docker?.ok) {
      await bootstrapRocketmqTopic(report.config.meta.rocketmqTopic);
    }
  }

  const modelFixture = needsModelFixture
    ? await startOpenAiModelFixture(E2E_PORTS.modelFixture)
    : null;

  report.gateway = await ensureGatewayRunning();

  report.e2e = await runPluginTests(pluginIds, { modelFixture });

  if (!opts.skipBrowser && pluginIds.some((id) => id === "web-mqtt" || id === "web-stomp")) {
    await runBrowserTests(pluginIds);
    const { browserResults } = await import("./browser-web-channels.mjs");
    report.browser = browserResults;
  }
  await modelFixture?.close();

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

main().catch((err) => {
  console.error(err);
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
