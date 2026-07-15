import * as oidc from "openid-client";

import type {
  AuthOAuth2Config,
  OAuth2TokenSet,
  OAuth2UserInfo,
} from "../shared/types.js";

function clientAuthentication(config: AuthOAuth2Config): oidc.ClientAuth {
  switch (config.client.clientAuthMethod) {
    case "client_secret_basic":
      return oidc.ClientSecretBasic(config.clientSecret);
    case "none":
      return oidc.None();
    case "client_secret_post":
    default:
      return oidc.ClientSecretPost(config.clientSecret);
  }
}

function normalizeTokenSet(
  response: oidc.TokenEndpointResponse & Partial<oidc.TokenEndpointResponseHelpers>,
  fallbackTtlSeconds: number,
): OAuth2TokenSet {
  const expiresIn = typeof response.expires_in === "number" && response.expires_in > 0
    ? response.expires_in
    : fallbackTtlSeconds;
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    tokenType: response.token_type ?? "Bearer",
    expiresAt: Date.now() + expiresIn * 1000,
    scope: response.scope,
    identityClaims: response.claims?.() as Record<string, unknown> | undefined,
  };
}

function requiredIdentity(
  claims: Record<string, unknown>,
  field: string,
): string {
  const value = claims[field];
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") {
    throw new Error(`[openclaw-oauth2] OAuth2 response is missing identity field ${field}`);
  }
  return String(value);
}

/** Framework-neutral standards client backed exclusively by openid-client. */
export class OAuth2Client {
  private configuration: oidc.Configuration | null = null;

  constructor(private readonly config: AuthOAuth2Config) {}

  async start(): Promise<void> {
    const issuer = new URL(this.config.issuerUrl);
    const clientMetadata = {
      client_secret: this.config.clientSecret,
      redirect_uris: [this.config.client.redirectUri],
      response_types: ["code"],
      token_endpoint_auth_method: this.config.client.clientAuthMethod,
    };
    const auth = clientAuthentication(this.config);
    if (this.config.client.discovery) {
      const timeout = Math.ceil(this.config.client.requestTimeoutMs / 1000);
      this.configuration = await oidc.discovery(
        issuer,
        this.config.clientId,
        clientMetadata,
        auth,
        {
          timeout,
          ...(issuer.protocol === "http:" ? { execute: [oidc.allowInsecureRequests] } : {}),
        },
      );
    } else {
      this.configuration = new oidc.Configuration({
        issuer: issuer.toString(),
        authorization_endpoint: this.config.client.authorizationEndpoint,
        token_endpoint: this.config.client.tokenEndpoint,
        userinfo_endpoint: this.config.client.userInfoEndpoint,
        introspection_endpoint: this.config.client.introspectionEndpoint,
        revocation_endpoint: this.config.client.revokeEndpoint,
        code_challenge_methods_supported: ["S256"],
      }, this.config.clientId, clientMetadata, auth);
      if (issuer.protocol === "http:") oidc.allowInsecureRequests(this.configuration);
    }
    this.configuration.timeout = Math.ceil(this.config.client.requestTimeoutMs / 1000);
  }

  createCodeVerifier(): string {
    return oidc.randomPKCECodeVerifier();
  }

  async buildAuthorizationUrl(state: string, codeVerifier: string): Promise<URL> {
    const configuration = this.requireConfiguration();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const parameters: Record<string, string> = {
      ...this.config.client.authorizationParameters,
      redirect_uri: this.config.client.redirectUri,
      scope: this.config.client.scopes.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    };
    return oidc.buildAuthorizationUrl(configuration, parameters);
  }

  async exchangeCode(callbackUrl: URL, state: string, codeVerifier: string): Promise<OAuth2TokenSet> {
    const response = await oidc.authorizationCodeGrant(
      this.requireConfiguration(),
      callbackUrl,
      { expectedState: state, pkceCodeVerifier: codeVerifier },
      this.config.client.tokenParameters,
    );
    return normalizeTokenSet(response, this.config.client.sessionTtlSeconds);
  }

  async refresh(refreshToken: string): Promise<OAuth2TokenSet> {
    const response = await oidc.refreshTokenGrant(
      this.requireConfiguration(),
      refreshToken,
      this.config.client.tokenParameters,
    );
    return normalizeTokenSet(response, this.config.client.sessionTtlSeconds);
  }

  async revoke(accessToken: string): Promise<void> {
    if (!this.requireConfiguration().serverMetadata().revocation_endpoint) return;
    await oidc.tokenRevocation(this.requireConfiguration(), accessToken, {
      token_type_hint: "access_token",
    });
  }

  async fetchUserInfo(accessToken: string): Promise<OAuth2UserInfo> {
    const configuration = this.requireConfiguration();
    if (!configuration.serverMetadata().userinfo_endpoint) {
      throw new Error("[openclaw-oauth2] userinfo endpoint is not configured");
    }
    const claims = await oidc.fetchUserInfo(
      configuration,
      accessToken,
      oidc.skipSubjectCheck,
    ) as Record<string, unknown>;
    return this.mapIdentity(claims);
  }

  async authenticateAccessToken(accessToken: string): Promise<OAuth2UserInfo | null> {
    const configuration = this.requireConfiguration();
    if (configuration.serverMetadata().introspection_endpoint) {
      const claims = await oidc.tokenIntrospection(configuration, accessToken);
      if (!claims.active) return null;
      return this.mapIdentity(claims as Record<string, unknown>);
    }
    return this.fetchUserInfo(accessToken);
  }

  async resolveIdentity(tokens: OAuth2TokenSet): Promise<OAuth2UserInfo | null> {
    if (tokens.identityClaims) return this.mapIdentity(tokens.identityClaims);
    return this.authenticateAccessToken(tokens.accessToken);
  }

  private mapIdentity(claims: Record<string, unknown>): OAuth2UserInfo {
    const tenantField = this.config.client.tenantIdField;
    const tenant = tenantField ? claims[tenantField] : undefined;
    return {
      userId: requiredIdentity(claims, this.config.client.userIdField),
      tenantId: typeof tenant === "string" && tenant.trim() ? tenant : undefined,
      scope: typeof claims.scope === "string" ? claims.scope : undefined,
      raw: claims,
    };
  }

  private requireConfiguration(): oidc.Configuration {
    if (!this.configuration) throw new Error("[openclaw-oauth2] OAuth2 client is not started");
    return this.configuration;
  }

  isReady(): boolean {
    return this.configuration !== null;
  }
}
