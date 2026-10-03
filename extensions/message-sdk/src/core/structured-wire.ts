import type { StructuredWireMessage, StructuredWirePart } from "./types.js";

/** 引用只能是无凭据、无查询参数的 HTTPS URL；授权另行由宿主执行。 */
export function validateStructuredMediaUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("structured media reference must be HTTPS"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || value !== url.href) {
    throw new Error("structured media reference must be canonical HTTPS without credentials, query or fragment");
  }
  return url;
}

/** 严格解码协议字段，丢弃未知对象属性，避免隐式携带敏感元数据。 */
export function parseStructuredWire(value: unknown): StructuredWireMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid structured wire object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) throw new Error("unsupported structured wire schemaVersion");
  const identity = (value: unknown): string => {
    if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new Error("invalid structured wire identity");
    return value;
  };
  if (!Array.isArray(raw.parts) || raw.parts.length === 0 || raw.parts.length > 1024) throw new Error("invalid structured wire parts");
  const parts: StructuredWirePart[] = raw.parts.map((part: unknown) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) throw new Error("invalid structured wire part");
    const item = part as Record<string, unknown>;
    if (item.type === "text" && typeof item.text === "string") return { type: "text", text: item.text };
    if (item.type === "media" && typeof item.url === "string" && ["image", "video", "audio", "document", "archive", "other"].includes(String(item.mediaType))) {
      validateStructuredMediaUrl(item.url);
      return { type: "media", mediaType: item.mediaType as Extract<StructuredWirePart, { type: "media" }>["mediaType"], url: item.url };
    }
    throw new Error("invalid structured wire part");
  });
  if (parts.filter((part) => part.type === "media").length > 8 ||
    parts.reduce((bytes, part) => bytes + Buffer.byteLength(part.type === "text" ? part.text : part.url, "utf8"), 0) > 1_048_576) {
    throw new Error("structured wire aggregate content or media count limit exceeded");
  }
  return { schemaVersion: 1, messageId: identity(raw.messageId), deliveryId: identity(raw.deliveryId), parts,
    ...(raw.replyTo === undefined ? {} : { replyTo: identity(raw.replyTo) }),
    ...(raw.threadId === undefined ? {} : { threadId: identity(raw.threadId) }),
  };
}

/** 经显式主机许可及宿主 SSRF/大小检查后返回可传输引用；默认拒绝。 */
export async function authorizeStructuredMedia(message: StructuredWireMessage, allowedHosts: readonly string[] = []): Promise<string[]> {
  message = parseStructuredWire(message);
  const authorized: string[] = [];
  for (const part of message.parts) {
    if (part.type !== "media") continue;
    const url = validateStructuredMediaUrl(part.url);
    if (!allowedHosts.includes(url.hostname)) throw new Error("structured media host is not authorized");
    const { loadWebMediaRaw } = await import("openclaw/plugin-sdk/web-media");
    await loadWebMediaRaw(part.url, { maxBytes: 8 * 1024 * 1024, localRoots: [],
      ssrfPolicy: { hostnameAllowlist: [url.hostname] },
    });
    authorized.push(part.url);
  }
  return authorized;
}
