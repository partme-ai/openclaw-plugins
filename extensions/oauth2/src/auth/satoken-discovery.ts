/**
 * OIDC Discovery + JWKS 自动获取与缓存
 *
 * 职责：
 * - 启动时从 issuerUrl/.well-known/openid-configuration 拉取配置
 * - 解析 jwks_uri、introspection_endpoint、scopes_supported
 * - 定时刷新（默认 1h）+ 强制刷新（JWT 验证 kid 找不到时触发）
 * - 使用 fetch 获取 JWKS（/.well-known/jwks.json），解析 RS256 公钥
 * - 内存缓存 Map<kid, CryptoKey>
 * - 错误处理：网络超时重试 3 次，降级到上次成功的缓存
 */

import type { OidcConfig, JWKS, JWK } from "../shared/types.js";
import { createPublicKey, type JsonWebKey, type KeyObject } from "node:crypto";

/** 默认 JWKS 缓存 TTL（秒） */
const DEFAULT_JWKS_CACHE_TTL = 3600;

/** 网络请求超时（毫秒） */
const FETCH_TIMEOUT = 10_000;

/** 最大重试次数 */
const MAX_RETRIES = 3;

/**
 * OIDC Discovery 管理器
 * 从 Sa-Token OAuth2 Server 获取 OIDC 配置和 JWKS 公钥
 */
export class SaTokenDiscovery {
  /** OIDC Issuer URL */
  private readonly issuerUrl: string;

  /** JWKS 缓存 TTL（秒） */
  private readonly jwksCacheTtl: number;

  /** 已缓存的 OIDC 配置 */
  private oidcConfig: OidcConfig | null = null;

  /** 已缓存的 JWKS 公钥：kid → KeyObject */
  private keyCache = new Map<string, KeyObject>();

  /** JWKS 上次刷新时间 */
  private jwksLastRefresh = 0;

  /** 定时刷新器 */
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(issuerUrl: string, jwksCacheTtl?: number) {
    // 移除末尾 /
    this.issuerUrl = issuerUrl.replace(/\/+$/, "");
    this.jwksCacheTtl = jwksCacheTtl ?? DEFAULT_JWKS_CACHE_TTL;
  }

  /**
   * 初始化 Discovery
   * 拉取 OIDC 配置和 JWKS 公钥，启动定时刷新
   */
  async init(): Promise<void> {
    // 拉取 OIDC 配置
    await this.fetchOidcConfig();

    // 拉取 JWKS 公钥
    await this.fetchJwks();

    // 定时刷新
    this.refreshTimer = setInterval(() => {
      this.fetchJwks().catch((err) => {
        console.error("[openclaw-oauth2] JWKS refresh failed:", err);
      });
    }, this.jwksCacheTtl * 1000);

    console.log(
      `[openclaw-oauth2] Discovery initialized: issuer=${this.issuerUrl}, ` +
      `keys=${this.keyCache.size}, ttl=${this.jwksCacheTtl}s`
    );
  }

  /**
   * 停止 Discovery
   */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * 获取 OIDC 配置
   */
  getOidcConfig(): OidcConfig | null {
    return this.oidcConfig;
  }

  /**
   * 获取 Introspection 端点 URL
   */
  getIntrospectionEndpoint(): string | null {
    return this.oidcConfig?.introspection_endpoint ?? null;
  }

  /**
   * 根据 kid 获取公钥
   * 缓存未命中时触发强制刷新
   *
   * @param kid - Key ID
   * @returns 公钥 KeyObject
   */
  async getPublicKey(kid: string): Promise<KeyObject | null> {
    // 从缓存获取
    let key = this.keyCache.get(kid);
    if (key) return key;

    // kid 未命中，强制刷新 JWKS
    console.log(`[openclaw-oauth2] Key kid=${kid} not found, refreshing JWKS`);
    await this.fetchJwks();

    key = this.keyCache.get(kid);
    return key ?? null;
  }

  /**
   * 获取第一个可用公钥（无 kid header 时使用）
   */
  getFirstKey(): KeyObject | null {
    const keys = Array.from(this.keyCache.values());
    return keys[0] ?? null;
  }

  /**
   * 拉取 OIDC Discovery 配置
   */
  private async fetchOidcConfig(): Promise<void> {
    const url = `${this.issuerUrl}/.well-known/openid-configuration`;

    try {
      const data = await this.fetchWithRetry(url);
      this.oidcConfig = data as OidcConfig;
      console.log(
        `[openclaw-oauth2] OIDC config fetched: jwks_uri=${this.oidcConfig.jwks_uri}`
      );
    } catch (error) {
      console.error(
        `[openclaw-oauth2] Failed to fetch OIDC config from ${url}:`,
        (error as Error).message
      );
      // 构造降级 OIDC 配置
      if (!this.oidcConfig) {
        this.oidcConfig = {
          issuer: this.issuerUrl,
          jwks_uri: `${this.issuerUrl}/.well-known/jwks.json`,
          introspection_endpoint: `${this.issuerUrl}/oauth2/check_token`,
        };
        console.log("[openclaw-oauth2] Using fallback OIDC config");
      }
    }
  }

  /**
   * 拉取 JWKS 公钥集
   */
  private async fetchJwks(): Promise<void> {
    const jwksUri = this.oidcConfig?.jwks_uri ?? `${this.issuerUrl}/.well-known/jwks.json`;

    try {
      const data = await this.fetchWithRetry(jwksUri);
      const jwks = data as JWKS;

      if (!jwks.keys || !Array.isArray(jwks.keys)) {
        console.warn("[openclaw-oauth2] JWKS response has no keys array");
        return;
      }

      // 解析公钥并缓存
      const newKeys = new Map<string, KeyObject>();
      for (const jwk of jwks.keys) {
        try {
          const keyObject = this.jwkToKeyObject(jwk);
          const kid = jwk.kid ?? `key-${newKeys.size}`;
          newKeys.set(kid, keyObject);
        } catch (err) {
          console.warn(
            `[openclaw-oauth2] Failed to parse JWK kid=${jwk.kid}:`,
            (err as Error).message
          );
        }
      }

      if (newKeys.size > 0) {
        this.keyCache = newKeys;
        this.jwksLastRefresh = Date.now();
        console.log(
          `[openclaw-oauth2] JWKS refreshed: ${newKeys.size} key(s) cached`
        );
      }
    } catch (error) {
      console.error(
        `[openclaw-oauth2] Failed to fetch JWKS from ${jwksUri}:`,
        (error as Error).message
      );
      // 保留上次成功的缓存
    }
  }

  /**
   * 将 JWK 转换为 Node.js KeyObject
   *
   * @param jwk - JSON Web Key
   * @returns KeyObject
   */
  private jwkToKeyObject(jwk: JWK): KeyObject {
    return createPublicKey({
      key: jwk as unknown as JsonWebKey,
      format: "jwk",
    });
  }

  /**
   * 带重试的 fetch 请求
   *
   * @param url - 请求 URL
   * @returns 解析后的 JSON 数据
   */
  private async fetchWithRetry(url: string): Promise<unknown> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        lastError = error as Error;
        if (attempt < MAX_RETRIES) {
          // 指数退避
          await new Promise((r) => setTimeout(r, attempt * 1000));
        }
      }
    }

    throw lastError ?? new Error("Fetch failed after retries");
  }
}
