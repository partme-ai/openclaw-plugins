/**
 * @fileoverview Token Introspection 降级回调模块。
 *
 * @module oauth2/auth/satoken-introspection
 *
 * 触发条件：
 * - Token 不是 JWT 格式（不含 "."）
 * - JWT 验证失败（如 kid 不匹配、签名算法变更）
 *
 * 职责：
 * - 使用 client_credentials 基础认证（Basic Auth）向 Sa-Token /oauth2/check_token POST
 * - 解析 RFC 7662 标准响应 + Sa-Token 自定义字段
 * - 缓存成功结果（短 TTL ~30s），避免高并发下重复回调
 * - 超时 3s，超时返回 503
 */

import type { IntrospectionResult, AuthOAuth2Config } from "../shared/types.js";
import type { SaTokenDiscovery } from "./satoken-discovery.js";

/** 默认 Introspection 缓存 TTL（毫秒） */
const DEFAULT_CACHE_TTL = 30_000;

/** Introspection 请求超时（毫秒） */
const INTROSPECTION_TIMEOUT = 3_000;

/**
 * Token Introspection 管理器
 * 对不透明 Token 执行 Sa-Token /oauth2/check_token 回调验证
 */
export class SaTokenIntrospection {
  /** OAuth2 配置 */
  private readonly config: AuthOAuth2Config;

  /** Discovery 实例（获取 introspection endpoint） */
  private readonly discovery: SaTokenDiscovery;

  /** 结果缓存：token → { result, timestamp } */
  private readonly cache = new Map<
    string,
    { result: IntrospectionResult; timestamp: number }
  >();

  /** 缓存 TTL（毫秒） */
  private readonly cacheTtl: number;

  constructor(config: AuthOAuth2Config, discovery: SaTokenDiscovery) {
    this.config = config;
    this.discovery = discovery;
    this.cacheTtl = (config.introspectionCacheTtl ?? 30) * 1000;
  }

  /**
   * 执行 Token Introspection
   * 先查缓存，未命中再调用远程端点
   *
   * @param token - 待验证的 Token（通常是 UUID 格式的 opaque token）
   * @returns Introspection 结果
   */
  async introspect(token: string): Promise<IntrospectionResult> {
    // 查缓存
    const cached = this.cache.get(token);
    if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
      return cached.result;
    }

    // 调用远程端点
    const result = await this.callIntrospectionEndpoint(token);

    // 缓存成功结果
    if (result.active) {
      this.cache.set(token, { result, timestamp: Date.now() });
      this.evictExpiredCache();
    }

    return result;
  }

  /**
   * 调用 Sa-Token /oauth2/check_token 端点
   *
   * 请求格式：
   * - Method: POST
   * - Authorization: Basic base64(clientId:clientSecret)
   * - Content-Type: application/x-www-form-urlencoded
   * - Body: token=<access_token>
   *
   * @param token - Access Token
   * @returns Introspection 结果
   */
  private async callIntrospectionEndpoint(
    token: string
  ): Promise<IntrospectionResult> {
    // 获取 introspection endpoint
    const endpoint = this.discovery.getIntrospectionEndpoint()
      ?? `${this.config.issuerUrl}/oauth2/check_token`;

    // 构造 Basic Auth
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret ?? ""}`
    ).toString("base64");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), INTROSPECTION_TIMEOUT);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: `token=${encodeURIComponent(token)}`,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(
          `[openclaw-oauth2] Introspection endpoint returned HTTP ${response.status}`
        );
        return { active: false };
      }

      const data = await response.json() as Record<string, unknown>;

      return {
        active: data.active === true,
        scope: data.scope as string | undefined,
        loginId: data.loginId as string | undefined,
        tenantId: data.tenantId as string | undefined,
        client_id: data.client_id as string | undefined,
        exp: data.exp as number | undefined,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === "AbortError") {
        console.error("[openclaw-oauth2] Introspection timeout (3s)");
      } else {
        console.error(
          "[openclaw-oauth2] Introspection request failed:",
          (error as Error).message
        );
      }

      return { active: false };
    }
  }

  /**
   * 清理过期缓存条目
   * 避免内存泄漏
   */
  private evictExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.cacheTtl) {
        this.cache.delete(key);
      }
    }
  }
}
