/**
 * @fileoverview 微信 iLink API/CDN 端点的凭据出站策略。
 *
 * Bot Token 与 CDN 上传参数都属于高敏凭据。仅检查 `https:` 不能阻止配置拼写或恶意二维码
 * 响应把凭据转发到任意公网主机，因此这里统一约束官方域名、URL 结构和显式自定义确认。
 * 回环 HTTP 只在 `allowCustom...=true` 时开放，专用于不接触真实凭据的隔离 E2E。
 */

const API_HOST = "ilinkai.weixin.qq.com";
const CDN_HOST = "novac2c.cdn.weixin.qq.com";

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function parseEndpoint(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not contain credentials, query, or fragment`);
  }
  return url;
}

/** 校验会携带 Bot Token 的 iLink API Origin。 */
export function validateWeixinApiBaseUrl(
  value: string,
  allowCustom = false,
): string {
  const url = parseEndpoint(value, "weixin.baseUrl");
  const loopback = isLoopback(url.hostname);
  if (url.protocol !== "https:" && !(allowCustom && loopback && url.protocol === "http:")) {
    throw new Error("weixin.baseUrl must use HTTPS (loopback HTTP requires allowCustomApiBaseUrl=true)");
  }
  if (url.hostname.toLowerCase() !== API_HOST && !loopback && !allowCustom) {
    throw new Error("weixin.baseUrl must use the official iLink host; custom hosts require allowCustomApiBaseUrl=true");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("weixin.baseUrl must be an origin without a path");
  }
  return url.toString().replace(/\/$/, "");
}

/** 校验 CDN 上传基址；官方地址固定保留 `/c2c` 路径。 */
export function validateWeixinCdnBaseUrl(
  value: string,
  allowCustom = false,
): string {
  const url = parseEndpoint(value, "weixin.cdnBaseUrl");
  const loopback = isLoopback(url.hostname);
  if (url.protocol !== "https:" && !(allowCustom && loopback && url.protocol === "http:")) {
    throw new Error("weixin.cdnBaseUrl must use HTTPS (loopback HTTP requires allowCustomCdnBaseUrl=true)");
  }
  const official = url.hostname.toLowerCase() === CDN_HOST && url.pathname === "/c2c";
  if (!official && !loopback && !allowCustom) {
    throw new Error("weixin.cdnBaseUrl must use the official CDN endpoint; custom hosts require allowCustomCdnBaseUrl=true");
  }
  return url.toString().replace(/\/$/, "");
}

/**
 * 二维码状态只能跳转到腾讯控制的 `weixin.qq.com` 主机；这里不接受自定义代理确认，
 * 因为该值来自远端响应而非管理员配置。
 */
export function resolveTrustedQrRedirectBaseUrl(value: string): string {
  const host = value.trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith(".")) {
    throw new Error("Weixin QR redirect_host is invalid");
  }
  if (host !== "weixin.qq.com" && !host.endsWith(".weixin.qq.com")) {
    throw new Error("Weixin QR redirect_host is not an official weixin.qq.com host");
  }
  return `https://${host}`;
}

/** 登录完成响应中的 API 地址必须仍是官方 iLink Origin。 */
export function validateTrustedLoginBaseUrl(value: string | undefined): string {
  return validateWeixinApiBaseUrl(value?.trim() || `https://${API_HOST}`, false);
}
