import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { E2E_PORTS } from "../../lib/utils.mjs";

/** The trusted-proxy fixture needs an attributable non-loopback client IP. */
export function oauth2ClientAddress() {
  const interfaces = Object.entries(networkInterfaces());
  interfaces.sort(([left], [right]) => Number(!/^(en|eth)/.test(left)) - Number(!/^(en|eth)/.test(right)));
  const addresses = interfaces.flatMap(([, entries]) => (entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal && isIP(entry.address) === 4 && entry.address !== "0.0.0.0")
    .map((entry) => entry.address));
  const configured = process.env.E2E_OAUTH2_CLIENT_ADDRESS;
  if (configured) {
    if (!addresses.includes(configured)) {
      throw new Error("E2E_OAUTH2_CLIENT_ADDRESS must be a non-loopback IPv4 address assigned to this host");
    }
    return configured;
  }
  if (addresses[0]) return addresses[0];
  throw new Error("OAuth2 E2E requires a non-loopback IPv4 host interface for trusted-proxy attribution");
}

/** @param {import('./mqtt.mjs').ConfigContext} ctx */
export function oauth2Config(ctx) {
  const provider = `http://127.0.0.1:${E2E_PORTS.oauth2Provider}`;
  oauth2ClientAddress();
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
            // The plugin permits HTTP callbacks only for loopback development.
            // The adapter binds its client source to a host interface while
            // connecting to this loopback listener for Gateway attribution.
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
