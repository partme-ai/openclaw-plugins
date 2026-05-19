/**
 * rabbitmq channel 插件定义。
 * 负责账户状态、gateway 生命周期与 outbound 回包逻辑。
 */

import { rabbitmqOutbound } from "./outbound.js";
import { getStats, startRabbitmqServer, stopRabbitmqServer, trackInboundAccepted, trackInboundDropped, trackRoute } from "./rabbitmq-server.js";
import { resolveRabbitmqConfig, validateRabbitmqConfig } from "./rabbitmq-config.js";
import { getRabbitmqChannelConfig, setRabbitmqChannelConfig } from "./rabbitmq-state.js";
import { processInbound } from "./inbound.js";

/**
 * 单账户场景的 accountId。
 */
export const DEFAULT_ACCOUNT_ID = "default";

/**
 * 导出的 channel plugin。
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
    startAccount: async ({ runtime, abortSignal }: { runtime: { config: Record<string, unknown> }; abortSignal: AbortSignal }) => {
      const config = resolveRabbitmqConfig(runtime.config);
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
