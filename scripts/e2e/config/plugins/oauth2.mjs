import { E2E_PORTS } from "../../lib/utils.mjs";

/** @param {import('./mqtt.mjs').ConfigContext} ctx */
export function oauth2Config(ctx) {
  const provider = `http://127.0.0.1:${E2E_PORTS.oauth2Provider}`;
  return {
    pluginEntry: {
      oauth2: {
        enabled: true,
        config: {
          enabled: true,
          issuerUrl: provider,
          clientId: "openclaw-e2e",
          clientSecret: "openclaw-e2e-client-secret",
          proxy: {
            listenHost: "127.0.0.1",
            listenPort: E2E_PORTS.oauth2Proxy,
            upstreamHost: "127.0.0.1",
            upstreamPort: ctx.gatewayPort,
            userHeader: "x-forwarded-user",
            forwardedProto: "http",
          },
          client: {
            discovery: false,
            redirectUri: `http://127.0.0.1:${E2E_PORTS.oauth2Proxy}/auth/oauth2/callback`,
            authorizationEndpoint: `${provider}/authorize`,
            tokenEndpoint: `${provider}/token`,
            introspectionEndpoint: `${provider}/introspect`,
            revokeEndpoint: `${provider}/revoke`,
            clientAuthMethod: "client_secret_basic",
            scopes: ["openid", "profile", "openclaw:operator"],
            requiredScopes: ["openclaw:operator"],
            sessionSecret: "openclaw-e2e-session-secret-at-least-32-characters",
            secureCookies: false,
            unauthorizedMode: "unauthorized",
          },
        },
      },
    },
    channelEntry: {},
  };
}

