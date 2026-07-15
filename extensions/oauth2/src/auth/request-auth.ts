import type { IncomingMessage } from "node:http";

import type { AuthContext } from "../shared/types.js";

export function extractBearerToken(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice(7).trim() || null;
  }
  return null;
}

export function toOpenClawScopes(context: AuthContext): string[] {
  if (context.role === "admin") {
    return ["operator.read", "operator.write", "operator.admin", "operator.approvals", "operator.pairing"];
  }
  if (context.role === "operator") return ["operator.read", "operator.write"];
  return ["operator.read"];
}
