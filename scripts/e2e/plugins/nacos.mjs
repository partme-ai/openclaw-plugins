import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  NACOS_E2E_SERVICE,
  nacosRevisionConfig,
  publishNacosConfig,
} from "../bootstrap/nacos-config.mjs";
import { GATEWAY_PORT, STATE_DIR } from "../lib/utils.mjs";
import { runAdapterTest } from "./_context.mjs";

function activeRevision() {
  const config = JSON.parse(readFileSync(join(STATE_DIR, "openclaw.json"), "utf8"));
  return config.plugins?.entries?.nacos?.config?.metadata?.e2eRevision;
}

async function namingInstances(ctx) {
  const query = new URLSearchParams({
    serviceName: NACOS_E2E_SERVICE,
    groupName: "DEFAULT_GROUP",
    healthyOnly: "true",
  });
  const response = await fetch(
    `http://127.0.0.1:${ctx.ports.nacosHttp}/nacos/v1/ns/instance/list?${query}`,
  );
  if (!response.ok) throw new Error(`Nacos naming query failed: ${response.status}`);
  return response.json();
}

/** Gateway 应用远端配置时会按 OpenClaw 语义原地重启，轮询窗口内连接失败是预期状态。 */
async function safeGatewayHealth(ctx) {
  try {
    return await ctx.gatewayFetch("/nacos/health");
  } catch {
    return null;
  }
}

async function namingRevision(ctx, revision) {
  try {
    const payload = await namingInstances(ctx);
    return Array.isArray(payload.hosts) && payload.hosts.some((host) =>
      host.ip === "127.0.0.1" && host.port === GATEWAY_PORT &&
      host.metadata?.e2eRevision === revision);
  } catch {
    return false;
  }
}

/**
 * 最终 tarball 安装态 Nacos E2E：同时覆盖 Naming 注册、集群自过滤、Config 订阅、
 * 写盘前备份，以及无环境变量时保持上一份有效配置的失败关闭语义。
 */
export async function testNacos(ctx, results) {
  await runAdapterTest(
    ctx,
    "nacos",
    async () => {
      await ctx.waitFor(async () => {
        const health = await safeGatewayHealth(ctx);
        return health?.status === 200 && health.json?.status === "ok" &&
          health.json?.configSync?.running === true && health.json?.naming?.registered === true &&
          health.json?.clusterDiscovery?.running === true;
      }, { label: "Nacos plugin health", timeoutMs: 60_000 });

      await ctx.waitFor(async () => {
        const payload = await namingInstances(ctx);
        return Array.isArray(payload.hosts) && payload.hosts.some((host) =>
          host.ip === "127.0.0.1" && host.port === GATEWAY_PORT &&
          host.metadata?.provider === "openclaw-nacos" &&
          host.metadata?.gatewayPort === String(GATEWAY_PORT));
      }, { label: "Gateway instance in Nacos Naming", timeoutMs: 60_000 });

      const cluster = await ctx.gatewayFetch("/nacos/cluster");
      if (cluster.status !== 200 || cluster.json?.peerCount !== 0) {
        throw new Error(`Nacos cluster self-filter failed: ${cluster.status} ${cluster.text}`);
      }

      await ctx.waitFor(() => Promise.resolve(activeRevision() === "bootstrap"), {
        label: "bootstrap config applied",
        timeoutMs: 30_000,
      });
      await publishNacosConfig(nacosRevisionConfig("subscription"));
      await ctx.waitFor(() => Promise.resolve(activeRevision() === "subscription"), {
        label: "Nacos subscription config applied",
        timeoutMs: 60_000,
      });
      // 写盘会触发 Gateway 原地重启。等新实例携带新 revision 重新注册后，才进入
      // 故障注入，避免把故障配置恰好发布在启动窗口而失去订阅监听器。
      await ctx.waitFor(() => namingRevision(ctx, "subscription"), {
        label: "Gateway restarted with subscribed config",
        timeoutMs: 60_000,
      });
      await ctx.waitFor(async () => (await safeGatewayHealth(ctx))?.json?.status === "ok", {
        label: "Nacos plugin healthy after config restart",
        timeoutMs: 30_000,
      });

      const backups = readdirSync(STATE_DIR).filter((name) =>
        /^openclaw-nacos-\d{14}-[0-9a-f]{8}\.json$/u.test(name),
      );
      if (backups.length === 0 || backups.some((name) => !existsSync(join(STATE_DIR, name)))) {
        throw new Error("Nacos config sync did not create a unique pre-write backup");
      }

      await publishNacosConfig(nacosRevisionConfig("${NACOS_E2E_MISSING}"));
      await ctx.waitFor(async () => {
        const health = await safeGatewayHealth(ctx);
        return health?.json?.status === "degraded" &&
          String(health.json?.errors?.configSync).includes("Missing environment variable");
      }, { label: "Nacos invalid config health degradation", timeoutMs: 60_000 });
      if (activeRevision() !== "subscription") {
        throw new Error("invalid Nacos config replaced the last known-good OpenClaw config");
      }

      await publishNacosConfig(nacosRevisionConfig("recovered"));
      await ctx.waitFor(async () => {
        if (activeRevision() !== "recovered") return false;
        if (!(await namingRevision(ctx, "recovered"))) return false;
        const health = await safeGatewayHealth(ctx);
        return health?.json?.status === "ok" && health.json?.errors?.configSync === null;
      }, { label: "Nacos config recovery", timeoutMs: 60_000 });

      const retainedBackups = readdirSync(STATE_DIR).filter((name) =>
        /^openclaw-nacos-\d{14}-[0-9a-f]{8}\.json$/u.test(name),
      );
      if (retainedBackups.length < 1 || retainedBackups.length > 2) {
        throw new Error(
          `Nacos backup retention expected 1..2 files, found ${retainedBackups.length}`,
        );
      }
    },
    {
      service: `Nacos 2.5.1 on 127.0.0.1:${ctx.ports.nacosHttp}`,
      method: "tarball install + Naming registration + self discovery + Config subscribe/bounded backup/fail-closed/recovery",
    },
    results,
  );
}
