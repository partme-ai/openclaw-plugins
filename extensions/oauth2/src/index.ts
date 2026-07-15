import {
  buildJsonPluginConfigSchema,
  definePluginEntry,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";

import { resolveOAuth2Config } from "./config.js";
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
    scopeMapping: { type: "object" as const, additionalProperties: { type: "string" as const } },
    proxy: { type: "object" as const, additionalProperties: true },
    client: { type: "object" as const, additionalProperties: true },
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
export { extractBearerToken, toOpenClawScopes } from "./auth/request-auth.js";
export { OAuth2SessionStore } from "./auth/session-store.js";
export { resolveOAuth2Config } from "./config.js";
export { buildOAuth2ForwardHeaders, OAuth2ProxyServer } from "./proxy-server.js";
export type * from "./shared/types.js";

export default plugin;
