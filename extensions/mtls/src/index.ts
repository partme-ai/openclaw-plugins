/**
 * @fileoverview OpenClaw mTLS 身份认证反向代理插件的注册入口。
 *
 * 插件仅在 full registration 模式下注册服务；启动前验证证书配置和 Gateway trusted-proxy
 * 契约，随后管理 `MtlsProxyServer` 生命周期，并暴露受 Gateway 认证保护的脱敏状态端点。
 */
import {
  buildJsonPluginConfigSchema,
  definePluginEntry,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";

import { resolveMtlsConfig, validateMtlsGatewayIntegration } from "./config.js";
import { MtlsProxyServer } from "./proxy-server.js";
import { getMtlsStats } from "./runtime/stats.js";

let activeProxy: MtlsProxyServer | null = null;

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" as const, default: false },
    tls: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" as const, const: true },
        certFile: { type: "string" as const },
        keyFile: { type: "string" as const },
        caFile: { type: "string" as const },
        requestCert: { type: "boolean" as const, const: true },
        rejectUnauthorized: { type: "boolean" as const, const: true },
      },
    },
    proxy: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        listenHost: { type: "string" as const },
        listenPort: { type: "integer" as const, minimum: 0, maximum: 65535 },
        upstreamHost: { type: "string" as const, enum: ["127.0.0.1", "::1"] },
        upstreamPort: { type: "integer" as const, minimum: 1, maximum: 65535 },
        requestTimeoutMs: { type: "integer" as const, minimum: 1000 },
        userHeader: { type: "string" as const },
      },
    },
    protectedPaths: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["path", "match", "allowUnauthenticated"],
        properties: {
          path: { type: "string" as const },
          match: { type: "string" as const, enum: ["exact", "prefix"] },
          allowUnauthenticated: { type: "boolean" as const },
        },
      },
    },
    allowedClients: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        anyOf: [
          { required: ["cn"] },
          { required: ["issuer"] },
          { required: ["fingerprint"] },
        ],
        properties: {
          cn: { type: "string" as const },
          issuer: { type: "string" as const },
          fingerprint: { type: "string" as const },
        },
      },
    },
    skipPaths: { type: "array" as const, items: { type: "string" as const } },
    passthrough: { type: "boolean" as const, const: false, default: false },
    headerName: { type: "string" as const, default: "x-client-cert" },
    headerCertField: { type: "string" as const, default: "subject" },
  },
};

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "mtls",
  name: "OpenClaw mTLS Proxy",
  description: "Production mTLS reverse proxy for OpenClaw trusted-proxy authentication",
  configSchema: buildJsonPluginConfigSchema(configSchema, { cacheKey: "openclaw-mtls" }),
  register(api) {
    if (api.registrationMode !== "full") return;

    api.registerService({
      id: "openclaw-mtls-proxy",
      start: async (context) => {
        const config = resolveMtlsConfig(api.pluginConfig);
        if (!config.enabled) {
          context.logger.info("[openclaw-mtls] disabled; proxy not started");
          return;
        }
        validateMtlsGatewayIntegration(config, api.config);
        activeProxy = new MtlsProxyServer(config, context.logger);
        await activeProxy.start();
      },
      stop: async () => {
        await activeProxy?.stop();
        activeProxy = null;
      },
    });

    api.registerHttpRoute({
      path: "/mtls/status",
      auth: "gateway",
      match: "exact",
      handler: async (_request, response) => {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(
          JSON.stringify({
            ok: true,
            running: activeProxy?.address() !== null && activeProxy !== null,
            proxy: activeProxy?.address() ?? null,
            stats: getMtlsStats(),
          }),
        );
      },
    });
  },
});

export { resolveMtlsConfig, validateMtlsGatewayIntegration } from "./config.js";
export { authorizeMtlsRequest, buildForwardHeaders, isPathProtected } from "./policy.js";
export { extractClientCertificate, MtlsProxyServer } from "./proxy-server.js";
export { getMtlsStats } from "./runtime/stats.js";
export type * from "./shared/types.js";

export default plugin;
