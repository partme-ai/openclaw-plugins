/**
 * @fileoverview RabbitMQ Channel 插件定义。
 *
 * @description
 * 遵循 OpenClaw Base Profile 的 `channel.ts` 契约：账户解析、gateway 生命周期、
 * 入站消费回调与出站发布适配器的组合导出。
 *
 * @module channel
 */

import { rabbitmqOutbound } from "./outbound.js";
import { getStats, startRabbitmqServer, stopRabbitmqServer, trackInboundAccepted, trackInboundDropped, trackRoute } from "./transport/server.js";
import { resolveRabbitmqConfig, validateRabbitmqConfig } from "./config.js";
import { getRabbitmqChannelConfig, setRabbitmqChannelConfig } from "./state/state.js";
import { rabbitmqSetupAdapter, rabbitmqSetupWizard } from "./onboarding.js";
import { processInbound } from "./inbound.js";

/** @description 单账户场景下的默认 accountId。 */
export const DEFAULT_ACCOUNT_ID = "default";

/**
 * @description 导出的 RabbitMQ ChannelPlugin 实例，供 index/setup-entry 引用。
 */
export const rabbitmqChannel = {
  id: "rabbitmq",
  name: "RabbitMQ",
  meta: {
    id: "rabbitmq",
    label: "RabbitMQ",
    selectionLabel: "RabbitMQ",
    docsPath: "/channels/rabbitmq",
    blurb: "RabbitMQ channel with enterprise-grade controls.",
    aliases: ["rabbitmq"],
    order: 90,
  },
  capabilities: { chatTypes: ["direct"] as const },
  setupWizard: rabbitmqSetupWizard,
  setup: rabbitmqSetupAdapter,
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg: Record<string, unknown>) => {
      const config = resolveRabbitmqConfig(cfg);
      return {
        accountId: DEFAULT_ACCOUNT_ID,
        name: "RabbitMQ",
        enabled: true,
        configured: Boolean(config.url),
      };
    },
  },
  status: {
    buildAccountSnapshot: (cfg: Record<string, unknown>) => {
      const config = resolveRabbitmqConfig(cfg);
      const serviceStats = getStats();
      return {
        accountId: DEFAULT_ACCOUNT_ID,
        name: "RabbitMQ",
        enabled: true,
        configured: true,
        webhookPath: "/rabbitmq/status",
        extra: serviceStats,
      };
    },
  },
  gateway: {
    /**
     * @description 跟随 channel 生命周期启动 RabbitMQ 消费端。
     * @param root0 - ChannelGatewayContext（OpenClaw 2026.5+ 注入 `cfg`）。
     * @param root0.cfg - 完整网关配置。
     * @param root0.abortSignal - 账户停止时 abort，用于优雅 shutdown。
     */
    startAccount: async ({
      cfg,
      abortSignal,
    }: {
      cfg: Record<string, unknown>;
      abortSignal: AbortSignal;
    }) => {
      const config = resolveRabbitmqConfig(cfg ?? {});
      setRabbitmqChannelConfig(config);
      const issues = validateRabbitmqConfig(config);
      for (const issue of issues) {
        console.warn(`[openclaw-rabbitmq] config warning: ${issue}`);
      }

      await startRabbitmqServer(config, async (event) => {
        try {
          const result = await processInbound(event, config);
          if (result.accepted) {
            trackInboundAccepted();
            if (result.routeSource) trackRoute(result.routeSource);
            return { ok: true as const };
          } else {
            trackInboundDropped(result.reason ?? "unknown_drop_reason");
            return { ok: false as const, requeue: false, reason: result.reason ?? "drop" };
          }
        } catch (error) {
          trackInboundDropped(`inbound_dispatch_error:${String(error)}`);
          return { ok: false as const, requeue: config.consume.requeueOnError, reason: "dispatch_error" };
        }
      });

      await new Promise<void>((resolve) => {
        const onAbort = (): void => resolve();
        abortSignal.addEventListener("abort", onAbort, { once: true });
      });
      await stopRabbitmqServer();
    },
  },
  outbound: rabbitmqOutbound,
};
