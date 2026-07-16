import type { IncomingMessage } from "node:http";

export function extractBearerToken(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (!authorization) return null;
  const match = /^Bearer[ \t]+([^ \t,]+)[ \t]*$/i.exec(authorization);
  return match?.[1] ?? null;
}
