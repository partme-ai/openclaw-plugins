/**
 * JWT 本地验证模块（零网络开销主路径）
 *
 * 职责：
 * - 判断 Token 是否为 JWT：包含 2 个 "." 分隔符
 * - 解析 JWT header 获取 kid（Key ID）
 * - 从缓存的 JWKS 找到对应公钥
 * - 使用 crypto.verify() 验证 RS256 签名
 * - 校验标准 claims：exp、iss、aud
 * - 解析 Sa-Token 自定义 claims：loginId, loginType, tenantId, scope
 */

import { createVerify } from "node:crypto";
import type { SaTokenClaims, AuthOAuth2Config } from "./types.js";
import { JwtError } from "./types.js";
import type { SaTokenDiscovery } from "./satoken-discovery.js";

/**
 * 判断 Token 是否为 JWT 格式
 * JWT 由 3 段 base64url 编码的部分组成，用 "." 分隔
 *
 * @param token - 待检测 Token
 * @returns 是否为 JWT 格式
 */
export function isJwtToken(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3;
}

/**
 * 验证并解析 JWT Token
 *
 * 验证步骤：
 * 1. 分割 header.payload.signature
 * 2. 解析 header 获取 kid + alg
 * 3. 从 discovery 获取对应公钥
 * 4. 验证 RS256 签名
 * 5. 校验 exp、iss、aud
 * 6. 解析 Sa-Token 自定义 claims
 *
 * @param token - JWT Token
 * @param discovery - OIDC Discovery 实例
 * @param config - OAuth2 配置
 * @returns Sa-Token Claims
 * @throws JwtError
 */
export async function verifyJwt(
  token: string,
  discovery: SaTokenDiscovery,
  config: AuthOAuth2Config
): Promise<SaTokenClaims> {
  // 1. 分割 JWT
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new JwtError("Token is not a valid JWT format", "MALFORMED_TOKEN");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 2. 解析 header
  const header = decodeBase64Url(headerB64);
  let headerObj: Record<string, unknown>;
  try {
    headerObj = JSON.parse(header);
  } catch {
    throw new JwtError("Invalid JWT header", "MALFORMED_TOKEN");
  }

  const kid = headerObj.kid as string | undefined;
  const alg = headerObj.alg as string | undefined;

  // 目前只支持 RS256
  if (alg && alg !== "RS256") {
    throw new JwtError(`Unsupported algorithm: ${alg}`, "INVALID_SIGNATURE");
  }

  // 3. 获取公钥
  const publicKey = kid
    ? await discovery.getPublicKey(kid)
    : discovery.getFirstKey();

  if (!publicKey) {
    throw new JwtError(
      `Public key not found${kid ? ` for kid=${kid}` : ""}`,
      "KID_NOT_FOUND"
    );
  }

  // 4. 验证签名
  const signatureInput = `${headerB64}.${payloadB64}`;
  const signature = base64UrlToBuffer(signatureB64);

  const verifier = createVerify("RSA-SHA256");
  verifier.update(signatureInput);
  const isValid = verifier.verify(publicKey, signature);

  if (!isValid) {
    throw new JwtError("Invalid JWT signature", "INVALID_SIGNATURE");
  }

  // 5. 解析 payload
  const payloadStr = decodeBase64Url(payloadB64);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    throw new JwtError("Invalid JWT payload", "MALFORMED_TOKEN");
  }

  // 6. 校验标准 claims
  const now = Math.floor(Date.now() / 1000);

  // exp — 过期时间
  const exp = payload.exp as number | undefined;
  if (exp && exp < now) {
    throw new JwtError("Token has expired", "TOKEN_EXPIRED");
  }

  // iss — 签发者
  const iss = payload.iss as string | undefined;
  if (config.issuerUrl && iss && iss !== config.issuerUrl) {
    throw new JwtError(
      `Invalid issuer: expected ${config.issuerUrl}, got ${iss}`,
      "INVALID_ISSUER"
    );
  }

  // aud — 受众
  if (config.audience) {
    const aud = payload.aud;
    const audList = Array.isArray(aud) ? aud : [aud];
    if (!audList.includes(config.audience)) {
      throw new JwtError(
        `Invalid audience: expected ${config.audience}, got ${aud}`,
        "INVALID_AUDIENCE"
      );
    }
  }

  // 7. 构造 Sa-Token Claims
  const satokenConfig = config.satoken ?? {
    loginIdClaim: "loginId",
    tenantIdClaim: "tenantId",
    loginTypeClaim: "loginType",
  };

  const claims: SaTokenClaims = {
    loginId: payload[satokenConfig.loginIdClaim] as string | number ?? payload.sub ?? "",
    loginType: payload[satokenConfig.loginTypeClaim] as string | undefined,
    tenantId: payload[satokenConfig.tenantIdClaim] as string | undefined,
    scope: payload.scope as string | undefined,
    exp: exp ?? 0,
    iss: iss,
    aud: payload.aud as string | string[] | undefined,
    iat: payload.iat as number | undefined,
    client_id: payload.client_id as string | undefined,
  };

  return claims;
}

/**
 * Base64URL 解码为字符串
 */
function decodeBase64Url(input: string): string {
  // base64url → base64
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  // 补齐 padding
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf-8");
}

/**
 * Base64URL 解码为 Buffer
 */
function base64UrlToBuffer(input: string): Buffer {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64");
}
