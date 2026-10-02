/** 美团通知和消息回调解析：验签、校验请求并保留原始业务标识。 */
import { createHash, timingSafeEqual } from "node:crypto";
import { resolveMeituanNotificationType, type MeituanNotificationKind } from "./catalog.js";

export type MeituanNotification = {
  eventId: string;
  businessId: string;
  msgType: string;
  msgId: string;
  developerId: string;
  typeName: string;
  kind: MeituanNotificationKind;
  timestamp: number;
  ePoiId?: string;
  opBizCode?: string;
  payload: Record<string, unknown>;
  /** 已验签的原始业务 JSON；保留超过 JavaScript 安全整数范围的数字原文。 */
  messageRaw: string;
  fingerprint: string;
};

type ParseOptions = {
  body: string;
  contentType: string;
  developerId: string;
  signKey: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
  maxBodyBytes?: number;
};

export class MeituanCallbackError extends Error {
  constructor(readonly status: number, readonly code: number, message: string) {
    super(message);
    this.name = "MeituanCallbackError";
  }
}

function invalid(message: string, status = 400, code = -1): never {
  throw new MeituanCallbackError(status, code, message);
}

function readForm(body: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of new URLSearchParams(body)) {
    if (!key || Object.hasOwn(result, key)) invalid("duplicate or empty callback parameter");
    result[key] = value;
  }
  return result;
}

function readJson(body: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(quoteUnsafeIntegers(body)); } catch { invalid("invalid callback JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) invalid("callback JSON must be an object");
  rejectDuplicateTopLevelJsonKeys(body);
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") result[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = String(value);
    else if (key === "message" || key === "param") result[key] = rawTopLevelJsonValue(body, key) ?? JSON.stringify(value);
    else invalid("callback parameter has unsupported type");
  }
  return result;
}

/** 对 JSON 对象信封保留 message 的原始数字字面量，供签名与业务解析共用。 */
function rawTopLevelJsonValue(body: string, target: string): string | undefined {
  let depth = 0;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === "{" || char === "[") { depth++; continue; }
    if (char === "}" || char === "]") { depth--; continue; }
    if (char !== '"') continue;
    const start = index;
    for (index++; index < body.length; index++) {
      if (body[index] === "\\") { index++; continue; }
      if (body[index] === '"') break;
    }
    if (depth !== 1) continue;
    let next = index + 1;
    while (next < body.length && /\s/u.test(body[next] ?? "")) next++;
    if (body[next] !== ":" || JSON.parse(body.slice(start, index + 1)) !== target) continue;
    let valueStart = next + 1;
    while (valueStart < body.length && /\s/u.test(body[valueStart] ?? "")) valueStart++;
    let valueDepth = 0;
    let quoted = false;
    for (let cursor = valueStart; cursor < body.length; cursor++) {
      const current = body[cursor];
      if (quoted) {
        if (current === "\\") { cursor++; continue; }
        if (current === '"') quoted = false;
        continue;
      }
      if (current === '"') { quoted = true; continue; }
      if (current === "{" || current === "[") { valueDepth++; continue; }
      if (current === "}" || current === "]") {
        if (valueDepth === 0) {
          const raw = body.slice(valueStart, cursor).trim();
          return raw.startsWith('"') ? JSON.parse(raw) as string : compactJson(raw);
        }
        valueDepth--;
        continue;
      }
      if (current === "," && valueDepth === 0) {
        const raw = body.slice(valueStart, cursor).trim();
        return raw.startsWith('"') ? JSON.parse(raw) as string : compactJson(raw);
      }
    }
  }
  return undefined;
}

function compactJson(source: string): string {
  let output = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quoted) {
      output += char;
      if (char === "\\") { output += source[++index] ?? ""; continue; }
      if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; output += char; continue; }
    if (!/\s/u.test(char)) output += char;
  }
  return output;
}

/** 将 JSON 中超出 Number 安全范围的整数字面量转为字符串，保留精确十进制 ID。 */
function quoteUnsafeIntegers(source: string): string {
  let output = "";
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '"') {
      const start = index;
      for (index++; index < source.length; index++) {
        if (source[index] === "\\") { index++; continue; }
        if (source[index] === '"') break;
      }
      output += source.slice(start, index + 1);
      continue;
    }
    if (!/[-0-9]/u.test(source[index] ?? "")) { output += source[index]; continue; }
    const token = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    if (!token) { output += source[index]; continue; }
    output += /^-?\d+$/u.test(token) && (BigInt(token) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(token) < BigInt(Number.MIN_SAFE_INTEGER))
      ? JSON.stringify(token) : token;
    index += token.length - 1;
  }
  return output;
}

/** JSON.parse 会静默覆盖重复键；逐字符定位顶层键，避免验签与路由字段出现歧义。 */
function rejectDuplicateTopLevelJsonKeys(body: string): void {
  const keys = new Set<string>();
  let depth = 0;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === "{" || char === "[") { depth++; continue; }
    if (char === "}" || char === "]") { depth--; continue; }
    if (char !== '"') continue;
    const start = index;
    for (index++; index < body.length; index++) {
      if (body[index] === "\\") { index++; continue; }
      if (body[index] === '"') break;
    }
    if (depth !== 1) continue;
    let next = index + 1;
    while (/\s/u.test(body[next] ?? "") && next < body.length) next++;
    if (body[next] !== ":") continue;
    const key = JSON.parse(body.slice(start, index + 1)) as string;
    if (keys.has(key)) invalid("duplicate callback JSON parameter");
    keys.add(key);
  }
}

function one(parameters: Record<string, string>, aliases: readonly string[], required = true): string | undefined {
  const found = aliases.filter((key) => Object.hasOwn(parameters, key));
  if (found.length > 1) invalid("conflicting callback aliases");
  const value = found.length === 1 ? parameters[found[0]!] : undefined;
  if (required && !value?.trim()) invalid("missing callback parameter");
  return value?.trim();
}

function verifySignature(parameters: Record<string, string>, signKey: string, signature: string): void {
  if (!/^[a-fA-F0-9]{40}$/u.test(signature)) invalid("invalid callback signature", 401, -2);
  const source = signKey + Object.keys(parameters).sort().filter(
    (key) => !["sign", "signature"].includes(key.toLowerCase()) && parameters[key] !== "",
  ).map((key) => key + parameters[key]).join("");
  const expected = Buffer.from(createHash("sha1").update(source, "utf8").digest("hex"), "ascii");
  const actual = Buffer.from(signature.toLowerCase(), "ascii");
  if (!timingSafeEqual(expected, actual)) invalid("invalid callback signature", 401, -2);
}

/** 只解析异步通知/消息。返回值不包含签名、密钥或未经验证的原始请求。 */
export function parseMeituanCallback(options: ParseOptions): MeituanNotification {
  const { body, contentType, developerId, signKey } = options;
  if (!body || Buffer.byteLength(body, "utf8") > (options.maxBodyBytes ?? 65_536)) {
    invalid("callback body is empty or too large", 413);
  }
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  const parameters = mediaType === "application/json" ? readJson(body)
    : mediaType === "application/x-www-form-urlencoded" ? readForm(body)
      : invalid("unsupported callback content type", 415);
  const businessId = one(parameters, ["businessId", "business_id"])!;
  const msgType = one(parameters, ["msgType", "msg_type", "msgtype", "invokeType", "invoke_type"])!;
  const parsedDeveloperId = one(parameters, ["developerId", "developer_id"])!;
  const timestampText = one(parameters, ["timestamp"])!;
  const signature = one(parameters, ["sign", "signature"])!;
  const messageText = one(parameters, ["message", "param"])!;
  if (parsedDeveloperId !== developerId) invalid("callback developer mismatch", 403);
  if (!/^(?:\d{10}|\d{13})$/u.test(timestampText)) invalid("invalid callback timestamp", 400, -3);
  const timestamp = timestampText.length === 13 ? Math.floor(Number(timestampText) / 1_000) : Number(timestampText);
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (Math.abs(now - timestamp) > (options.toleranceSeconds ?? 300)) invalid("callback timestamp expired", 401, -3);
  verifySignature(parameters, signKey, signature);
  const type = resolveMeituanNotificationType(businessId, msgType);
  if (!type) invalid("unsupported notification type", 422);
  let payload: unknown;
  try { payload = JSON.parse(quoteUnsafeIntegers(messageText)); } catch { invalid("invalid callback message JSON"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) invalid("callback message must be a JSON object");
  const message = payload as Record<string, unknown>;
  const innerMessageId = typeof message.messageId === "string" ? message.messageId.trim()
    : typeof message.messageId === "number" && Number.isSafeInteger(message.messageId) && message.messageId >= 0
      ? String(message.messageId) : undefined;
  const msgId = one(parameters, ["msgId", "msg_id", "msgid"], false)
    ?? innerMessageId;
  if (!msgId || msgId.length > 128 || /[\u0000-\u001f\u007f]/u.test(msgId)) invalid("invalid callback msgId");
  const fingerprint = createHash("sha256").update(`${businessId}\0${msgType}\0${msgId}\0${messageText}`).digest("hex");
  const eventId = createHash("sha256").update(`${developerId}\0${businessId}\0${msgId}`).digest("hex");
  const ePoiId = one(parameters, ["ePoiId", "e_poi_id"], false);
  const opBizCode = one(parameters, ["opBizCode", "op_biz_code", "opbizcode"], false);
  return {
    eventId, businessId, msgType, msgId, developerId: parsedDeveloperId,
    typeName: type.name, kind: type.kind, timestamp, payload: message, messageRaw: messageText, fingerprint,
    ...(ePoiId ? { ePoiId } : {}), ...(opBizCode ? { opBizCode } : {}),
  };
}
