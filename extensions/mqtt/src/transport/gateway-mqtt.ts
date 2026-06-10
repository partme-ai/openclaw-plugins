/**
 * @module mqtt/transport/gateway-mqtt
 *
 * Gateway 账号生命周期：启动/停止内嵌 Aedes，与 OpenClaw `startAccount` 对齐。
 */

import type { ChannelAccountSnapshot, ChannelGatewayContext } from "openclaw/plugin-sdk";

import { startBroker, stopBroker } from "./server.js";
import { handleInboundMessage } from "../inbound.js";
import {
  configureSessionExpiry,
  handleClientDisconnected,
  markClientConnected,
} from "../routing/session-mapper.js";
import { loadTopicMappings } from "../routing/topic-router.js";
import { initQosHandler, stopQosHandler } from "./qos-handler.js";
import {
  hasLegacyMqttDmScope,
  resolveBrokerConfig,
  type ResolvedMqttAccount,
} from "../config.js";
import { setMqttChannelConfig } from "../state/mqtt-state.js";
import type { MqttTopicMapping } from "../types.js";

/**
 * 等待 Gateway 中止信号（账号停止或进程退出）。
 */
function waitForAbortSignal(abortSignal: AbortSignal): Promise<void> {
  if (abortSignal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onAbort = () => {
      abortSignal.removeEventListener("abort", onAbort);
      resolve();
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 长驻监控：启动 MQTT Broker，直到 `abortSignal` 触发后清理资源。
 */
export async function monitorMqttBroker(ctx: ChannelGatewayContext<ResolvedMqttAccount>): Promise<void> {
  try {
    const globalConfig = ctx.cfg as unknown as Record<string, unknown>;
    if (hasLegacyMqttDmScope(globalConfig)) {
      ctx.log?.warn?.(
        "[openclaw-mqtt] Detected legacy config `channels.mqtt.session.dmScope`; it is ignored. Use OpenClaw global `session.dmScope` instead.",
      );
    }
    const config = resolveBrokerConfig(globalConfig);
    const dmScope = (globalConfig.session as any)?.dmScope ?? 'per-peer';
    setMqttChannelConfig(config, dmScope);
    configureSessionExpiry(
      config.session.maxExpirySeconds,
      config.session.persistentAcrossReconnect,
    );

    const rawMappings = (globalConfig as { mqttTopicMappings?: unknown }).mqttTopicMappings;
    if (Array.isArray(rawMappings)) {
      loadTopicMappings(rawMappings as MqttTopicMapping[]);
    } else {
      loadTopicMappings(config.topicBindings);
    }

    initQosHandler((_topic, _payload, _messageId) => {
      ctx.log?.info?.("[openclaw-mqtt] QoS retry not yet implemented");
    });

    await startBroker(
      config,
      (message) => {
        void handleInboundMessage(message);
      },
      (clientId) => {
        markClientConnected(clientId);
      },
      (clientId) => {
        handleClientDisconnected(clientId);
      },
    );

    ctx.setStatus({
      accountId: ctx.account.accountId,
      running: true,
      configured: true,
      lastStartAt: Date.now(),
      webhookPath: "/mqtt/status",
      port: config.port,
    } as ChannelAccountSnapshot);

    ctx.log?.info?.(`[${ctx.account.accountId}] MQTT broker listening on tcp://0.0.0.0:${config.port}`);

    await waitForAbortSignal(ctx.abortSignal);
  } catch (err) {
    ctx.setStatus({
      accountId: ctx.account.accountId,
      running: false,
      lastError: String(err),
    } as ChannelAccountSnapshot);
    throw err;
  } finally {
    stopQosHandler();
    await stopBroker();
    setMqttChannelConfig(null);
    ctx.setStatus({
      accountId: ctx.account.accountId,
      running: false,
      lastStopAt: Date.now(),
    } as ChannelAccountSnapshot);
  }
}
