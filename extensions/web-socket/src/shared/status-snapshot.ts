/**
 * @module web-socket/shared/status-snapshot
 *
 * 状态接口采用显式白名单快照，不直接展开运行时配置。这样后续新增 Token、Header、证书路径等
 * 字段时不会自动进入管理 API；协议和 Header 只暴露数量，Client URL 删除所有凭据载体。
 */
import type { WebsocketChannelConfig } from "../types.js";
import { sanitizeWebSocketUrl } from "./redact.js";

/** 构造 `/web-socket/status` 可公开的配置摘要。 */
export function buildWebSocketStatusConfig(config: WebsocketChannelConfig): Record<string, unknown> {
  return {
    mode: config.mode,
    defaultAgentId: config.defaultAgentId,
    allowFrameAgentId: config.allowFrameAgentId,
    agentBindingCount: config.agentBindings.length,
    payload: { ...config.payload },
    limits: { ...config.limits },
    session: { ...config.session },
    server: {
      wsPort: config.server.wsPort,
      path: config.server.path,
      host: config.server.host,
      maxConnections: config.server.maxConnections,
      auth: { enabled: config.server.auth.enabled },
      allowedOrigins: [...config.server.allowedOrigins],
      tls: {
        enabled: config.server.tls.enabled,
        minVersion: config.server.tls.minVersion,
        requestCert: config.server.tls.requestCert,
        rejectUnauthorized: config.server.tls.rejectUnauthorized,
      },
      allowInsecureRemote: config.server.allowInsecureRemote,
    },
    client: {
      url: sanitizeWebSocketUrl(config.client.url),
      protocolCount: config.client.protocols.length,
      headerCount: Object.keys(config.client.headers).length,
      tokenConfigured: Boolean(config.client.token),
      clientId: config.client.clientId,
      connectTimeoutMs: config.client.connectTimeoutMs,
      allowInsecureRemote: config.client.allowInsecureRemote,
      reconnect: { ...config.client.reconnect },
    },
  };
}
