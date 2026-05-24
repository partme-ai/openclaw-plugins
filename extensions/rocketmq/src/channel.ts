/**
 * @fileoverview RocketMQ Channel 插件定义：gateway 生命周期与入站/出站绑定。
 *
 * @description
 * 实现 OpenClaw ChannelPlugin 契约：`startAccount` 启动 transport PushConsumer，
 * 入站经 `processInbound`，出站经 `rockermqOutbound`；status 暴露 `/rocketmq/status` 快照。
 *
 * @module channel
 */

/**
 * RocketMQ Channel — Base Profile 入口。
 */

import { rockermqSetupAdapter, rockermqSetupWizard } from "./onboarding.js";
import { processInbound } from "./inbound.js";
import { rockermqOutbound } from "./outbound.js";
import {
  buildRockermqConfigSnapshot,
  resolveRockermqConfig,
  validateRockermqConfig,
} from "./config.js";
import { setRockermqChannelConfig } from "./state/state.js";
import {
  getStats,
  startRockermqServer,
  stopRockermqServer,
  trackInboundAccepted,
  trackInboundDropped,
  trackRoute,
} from "./transport/server.js";

/** @description 默认单账户 ID。 */
export const DEFAULT_ACCOUNT_ID = "default";

/** @description 导出的 RocketMQ ChannelPlugin。 */
export const rockermqChannel = {
  id: "rocketmq",
  name: "RocketMQ",
  meta: {
    id: "rocketmq",
    label: "RocketMQ",
    selectionLabel: "RocketMQ",
    docsPath: "/channels/rocketmq",
    blurb: "RocketMQ channel with producer and push-consumer support.",
    aliases: ["rocketmq"],
    order: 91,
  },
  capabilities: { chatTypes: ["direct"] as const },
  setupWizard: rockermqSetupWizard,
  setup: rockermqSetupAdapter,
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
        webhookPath: "/rocketmq/status",
        extra: {
          stats: serviceStats,
          config: buildRockermqConfigSnapshot(config),
        },
      };
    },
  },
  gateway: {
    /**
     * @description 跟随 channel 生命周期启动 RocketMQ Producer/PushConsumer。
     * @param root0 - ChannelGatewayContext。
     * @param root0.cfg - 完整网关配置。
     * @param root0.abortSignal - 账户停止时 abort，用于优雅 shutdown。
     * @returns 在 abort 前保持运行的 Promise。
     * @throws transport 连接失败或配置无效时可能抛出。
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
        console.warn(`[openclaw-rocketmq] config warning: ${issue}`);
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
