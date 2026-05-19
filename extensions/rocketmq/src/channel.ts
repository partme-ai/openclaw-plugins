/**
 * RocketMQ channel 插件定义。
 * 负责账户状态、gateway 生命周期与 outbound 回包逻辑。
 */

import { processInbound } from "./inbound.js";
import { rockermqOutbound } from "./outbound.js";
import {
  buildRockermqConfigSnapshot,
  resolveRockermqConfig,
  validateRockermqConfig,
} from "./rockermq-config.js";
import { setRockermqChannelConfig } from "./rockermq-state.js";
import {
  getStats,
  startRockermqServer,
  stopRockermqServer,
  trackInboundAccepted,
  trackInboundDropped,
  trackRoute,
} from "./rockermq-server.js";

export const DEFAULT_ACCOUNT_ID = "default";

/**
 * OpenClaw RocketMQ channel 插件。
 */
export const rockermqChannel = {
  id: "rockermq",
  name: "RocketMQ",
  meta: {
    id: "rockermq",
    label: "RocketMQ",
    selectionLabel: "RocketMQ",
    docsPath: "/channels/rockermq",
    blurb: "RocketMQ channel with producer and push-consumer support.",
    aliases: ["rockermq"],
    order: 91,
  },
  capabilities: { chatTypes: ["direct"] as const },
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg: Record<string, unknown>) => {
      const config = resolveRockermqConfig(cfg);
      return {
        accountId: DEFAULT_ACCOUNT_ID,
        name: "RocketMQ",
        enabled: true,
        configured: Boolean(config.endpoints),
      };
    },
  },
  status: {
    buildAccountSnapshot: (cfg: Record<string, unknown>) => {
      const config = resolveRockermqConfig(cfg);
      const serviceStats = getStats();
      return {
        accountId: DEFAULT_ACCOUNT_ID,
        name: "RocketMQ",
        enabled: true,
        configured: Boolean(config.endpoints),
        webhookPath: "/rockermq/status",
        extra: {
          stats: serviceStats,
          config: buildRockermqConfigSnapshot(config),
        },
      };
    },
  },
  gateway: {
    /**
     * 跟随 channel 生命周期启动 RocketMQ 客户端。
     * ChannelGatewayContext 提供 cfg（完整配置）、abortSignal、log 等。
     */
    startAccount: async ({
      cfg,
      abortSignal,
    }: {
      cfg: Record<string, unknown>;
      abortSignal: AbortSignal;
    }) => {
      const config = resolveRockermqConfig(cfg);
      setRockermqChannelConfig(config);
      for (const issue of validateRockermqConfig(config)) {
        console.warn(`[openclaw-rockermq] config warning: ${issue}`);
      }

      await startRockermqServer(config, async (event) => {
        try {
          const result = await processInbound(event, config);
          if (result.accepted) {
            trackInboundAccepted();
            if (result.routeSource) trackRoute(result.routeSource);
            return { ok: true as const };
          }
          trackInboundDropped(result.reason ?? "unknown_drop_reason");
          return {
            ok: false as const,
            reconsume: false,
            reason: result.reason ?? "drop",
          };
        } catch (error) {
          trackInboundDropped(`inbound_dispatch_error:${String(error)}`);
          return {
            ok: false as const,
            reconsume: config.consumer.reconsumeOnError,
            reason: "dispatch_error",
          };
        }
      });

      await new Promise<void>((resolve) => {
        abortSignal.addEventListener("abort", () => resolve(), { once: true });
      });
      await stopRockermqServer();
    },
  },
  outbound: rockermqOutbound,
};
