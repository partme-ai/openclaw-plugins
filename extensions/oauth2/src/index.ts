import {
  buildJsonPluginConfigSchema,
  definePluginEntry,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";

import { resolveOAuth2Config, validateOAuth2GatewayIntegration } from "./config.js";
import { OAuth2ProxyServer } from "./proxy-server.js";

let activeProxy: OAuth2ProxyServer | null = null;

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" as const, default: false },
    issuerUrl: { type: "string" as const },
    clientId: { type: "string" as const },
    clientSecret: { type: "string" as const },
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
        tenantHeader: { type: "string" as const },
        forwardedProto: { type: "string" as const, enum: ["http", "https"] },
      },
    },
    client: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        discovery: { type: "boolean" as const },
        redirectUri: { type: "string" as const },
        scopes: { type: "array" as const, items: { type: "string" as const } },
        requiredScopes: { type: "array" as const, items: { type: "string" as const } },
        authorizationEndpoint: { type: "string" as const },
        tokenEndpoint: { type: "string" as const },
        revokeEndpoint: { type: "string" as const },
        userInfoEndpoint: { type: "string" as const },
        introspectionEndpoint: { type: "string" as const },
        clientAuthMethod: { type: "string" as const, enum: ["client_secret_post", "client_secret_basic", "none"] },
        authorizationParameters: { type: "object" as const, additionalProperties: { type: "string" as const } },
        tokenParameters: { type: "object" as const, additionalProperties: { type: "string" as const } },
        requestTimeoutMs: { type: "integer" as const, minimum: 1000 },
        successRedirect: { type: "string" as const },
        sessionSecret: { type: "string" as const, minLength: 32 },
        sessionCookieName: { type: "string" as const },
        sessionTtlSeconds: { type: "integer" as const, minimum: 60 },
        stateTtlSeconds: { type: "integer" as const, minimum: 60 },
        secureCookies: { type: "boolean" as const },
        userIdField: { type: "string" as const },
        tenantIdField: { type: "string" as const },
        unauthorizedMode: { type: "string" as const, enum: ["auto", "redirect", "unauthorized"] },
        sessionStore: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            type: { type: "string" as const, enum: ["memory", "redis"] },
            redisUrl: { type: "string" as const },
            keyPrefix: { type: "string" as const },
            maxEntries: { type: "integer" as const, minimum: 1 },
          },
        },
      },
    },
  },
};

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "oauth2",
  name: "OpenClaw OAuth2 Client",
  description: "Standard OAuth2/OIDC authorization proxy powered by openid-client",
  configSchema: buildJsonPluginConfigSchema(configSchema, { cacheKey: "openclaw-oauth2" }),
  register(api) {
    if (api.registrationMode !== "full") return;

    api.registerService({
      id: "openclaw-oauth2-proxy",
      start: async (context) => {
        const config = resolveOAuth2Config(api.pluginConfig);
        if (!config.enabled) {
          context.logger.info("[openclaw-oauth2] disabled; proxy not started");
          return;
        }
        validateOAuth2GatewayIntegration(config, api.config);
        activeProxy = new OAuth2ProxyServer(config, context.logger);
        await activeProxy.start();
      },
      stop: async () => {
        await activeProxy?.stop();
        activeProxy = null;
      },
    });

    api.registerHttpRoute({
      path: "/auth/oauth2/status",
      auth: "gateway",
      match: "exact",
      handler: async (_request, response) => {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
          ok: true,
          running: activeProxy?.address() !== null && activeProxy !== null,
          proxy: activeProxy?.address() ?? null,
          oauth2Ready: activeProxy !== null,
        }));
      },
    });
  },
});

export { OAuth2Client } from "./auth/oauth2-client.js";
export { extractBearerToken } from "./auth/request-auth.js";
export { OAuth2SessionStore } from "./auth/session-store.js";
export { resolveOAuth2Config, validateOAuth2GatewayIntegration } from "./config.js";
export { buildOAuth2ForwardHeaders, OAuth2ProxyServer } from "./proxy-server.js";
export type * from "./shared/types.js";

export default plugin;
