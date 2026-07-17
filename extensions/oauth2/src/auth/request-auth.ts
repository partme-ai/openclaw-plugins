import type { IncomingMessage } from "node:http";

/**
 * 从 HTTP 请求中提取标准 Bearer Token。
 *
 * 只接受单一 `Bearer <token>` 形态，拒绝逗号拼接、多段空白中的额外字段和其他认证
 * scheme，避免代理层与外部 OAuth2 Server 对 Authorization Header 产生不同解释。
 */
export function extractBearerToken(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (!authorization) return null;
  const match = /^Bearer[ \t]+([^ \t,]+)[ \t]*$/i.exec(authorization);
  return match?.[1] ?? null;
}
