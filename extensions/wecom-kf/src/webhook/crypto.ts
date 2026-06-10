/**
 * @module wecom-kf/webhook/crypto
 *
 * 企业微信客服回调加解密与签名校验（AES-CBC + PKCS#7 block=32 + SHA1 签名）。
 */

import crypto from "node:crypto";
import { parseXml } from "../shared/xml-parser.js";

/**
 * 将企业微信配置的 Base64 EncodingAESKey 解码为 32 字节 Buffer。
 *
 * @param encodingAESKey - 企微后台配置的 EncodingAESKey
 * @returns 32 字节 AES key Buffer
 * @throws 缺失或解码后长度不为 32 字节
 */
export function decodeEncodingAESKey(encodingAESKey: string): Buffer {
  const trimmed = encodingAESKey.trim();
  if (!trimmed) throw new Error("encodingAESKey missing");
  const withPadding = trimmed.endsWith("=") ? trimmed : `${trimmed}=`;
  const key = Buffer.from(withPadding, "base64");
  if (key.length !== 32) {
    throw new Error(`invalid encodingAESKey (expected 32 bytes after base64 decode, got ${key.length})`);
  }
  return key;
}

// WeCom uses PKCS#7 padding with a block size of 32 bytes (not AES's 16-byte block).
// This is compatible with AES-CBC as 32 is a multiple of 16, but it requires manual padding/unpadding.
export const WECOM_PKCS7_BLOCK_SIZE = 32;

function pkcs7Pad(buf: Buffer, blockSize: number): Buffer {
  const mod = buf.length % blockSize;
  const pad = mod === 0 ? blockSize : blockSize - mod;
  const padByte = Buffer.from([pad]);
  return Buffer.concat([buf, Buffer.alloc(pad, padByte[0]!)]);
}

/**
 * 移除 AES 解密后的 PKCS#7 填充（企微 block size = 32）。
 *
 * @param buf - 解密后的 padded buffer
 * @param blockSize - PKCS#7 块大小（企微为 32）
 * @returns 去除填充后的 buffer
 * @throws 填充非法或 payload 过短
 */
export function pkcs7Unpad(buf: Buffer, blockSize: number): Buffer {
  if (buf.length === 0) throw new Error("invalid pkcs7 payload");
  const pad = buf[buf.length - 1]!;
  if (pad < 1 || pad > blockSize) {
    throw new Error("invalid pkcs7 padding");
  }
  if (pad > buf.length) {
    throw new Error("invalid pkcs7 payload");
  }
  // Best-effort validation (all padding bytes equal).
  for (let i = 0; i < pad; i += 1) {
    if (buf[buf.length - 1 - i] !== pad) {
      throw new Error("invalid pkcs7 padding");
    }
  }
  return buf.subarray(0, buf.length - pad);
}

function sha1Hex(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex");
}

/**
 * 计算企微回调 msg_signature（sha1(sort(token, timestamp, nonce, encrypt))）。
 *
 * @param params - token、timestamp、nonce、encrypt
 * @returns 小写 hex SHA1 签名
 */
export function computeWecomMsgSignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  encrypt: string;
}): string {
  const parts = [params.token, params.timestamp, params.nonce, params.encrypt]
    .map((v) => String(v ?? ""))
    .sort();
  return sha1Hex(parts.join(""));
}

/**
 * 验证企微回调 msg_signature 是否与计算值一致。
 *
 * @param params - token、timestamp、nonce、encrypt、signature
 * @returns 签名是否有效
 */
export function verifyWecomSignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  encrypt: string;
  signature: string;
}): boolean {
  const expected = computeWecomMsgSignature({
    token: params.token,
    timestamp: params.timestamp,
    nonce: params.nonce,
    encrypt: params.encrypt,
  });
  return expected === params.signature;
}

/**
 * 解密企微 AES 加密包为明文 XML/文本。
 *
 * @param params - encodingAESKey、encrypt（Base64）、可选 receiveId 校验
 * @returns 解密后的明文字符串
 * @throws 解密失败或 receiveId 不匹配
 */
export function decryptWecomEncrypted(params: {
  encodingAESKey: string;
  receiveId?: string;
  encrypt: string;
}): string {
  const aesKey = decodeEncodingAESKey(params.encodingAESKey);
  const iv = aesKey.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
  decipher.setAutoPadding(false);
  const decryptedPadded = Buffer.concat([
    decipher.update(Buffer.from(params.encrypt, "base64")),
    decipher.final(),
  ]);
  const decrypted = pkcs7Unpad(decryptedPadded, WECOM_PKCS7_BLOCK_SIZE);

  if (decrypted.length < 20) {
    throw new Error(`invalid decrypted payload (expected at least 20 bytes, got ${decrypted.length})`);
  }

  // 16 bytes random + 4 bytes network-order length + msg + receiveId (optional)
  const msgLen = decrypted.readUInt32BE(16);
  const msgStart = 20;
  const msgEnd = msgStart + msgLen;
  if (msgEnd > decrypted.length) {
    throw new Error(`invalid decrypted msg length (msgEnd=${msgEnd}, payloadLength=${decrypted.length})`);
  }
  const msg = decrypted.subarray(msgStart, msgEnd).toString("utf8");

  const receiveId = params.receiveId ?? "";
  if (receiveId) {
    const trailing = decrypted.subarray(msgEnd).toString("utf8");
    if (trailing !== receiveId) {
      throw new Error(`receiveId mismatch (expected "${receiveId}", got "${trailing}")`);
    }
  }

  return msg;
}

/**
 * 将明文打包并 AES 加密为企微回调响应格式（Base64）。
 *
 * @param params - encodingAESKey、plaintext、可选 receiveId
 * @returns Base64 密文
 */
export function encryptWecomPlaintext(params: {
  encodingAESKey: string;
  receiveId?: string;
  plaintext: string;
}): string {
  const aesKey = decodeEncodingAESKey(params.encodingAESKey);
  const iv = aesKey.subarray(0, 16);
  const random16 = crypto.randomBytes(16);
  const msg = Buffer.from(params.plaintext ?? "", "utf8");
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32BE(msg.length, 0);
  const receiveId = Buffer.from(params.receiveId ?? "", "utf8");

  const raw = Buffer.concat([random16, msgLen, msg, receiveId]);
  const padded = pkcs7Pad(raw, WECOM_PKCS7_BLOCK_SIZE);
  const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString("base64");
}

/**
 * 从企微回调 XML 中提取 Encrypt 字段。
 *
 * @param xml - 回调 XML 字符串
 * @returns Encrypt 节点内容
 * @throws 未找到 Encrypt 字段
 */
export function extractEncryptFromXml(xml: string): string {
    const match = xml.match(/<Encrypt>(<!\[CDATA\[)?(.*?)(\]\]>)?<\/Encrypt>/s);
    if (!match || !match[2]) {
        throw new Error("Encrypt field not found in XML");
    }
    return match[2]!;
}

/**
 * 解析企微 KF 回调（GET 验 URL / POST 解密事件）。
 *
 * @param query - URL 查询参数（msg_signature、timestamp、nonce、echostr）
 * @param body - POST 请求体 XML；GET 验证时为 null
 * @param token - 回调 Token
 * @param encodingAESKey - 回调 EncodingAESKey
 * @param receiveId - 接收者 ID（一般为 corpId）
 * @returns verify 或 event 解析结果
 * @throws 签名无效、缺少 body 或解密失败
 */
export function parseWecomCallback(
  query: { msg_signature?: string; timestamp?: string; nonce?: string; echostr?: string },
  body: string | null,
  token: string,
  encodingAESKey: string,
  receiveId?: string,
): { type: "verify" | "event"; echostr?: string; data?: Record<string, unknown> } {
  const timestamp = query.timestamp ?? "";
  const nonce = query.nonce ?? "";
  const signature = query.msg_signature ?? "";

  // GET URL 验证：encrypt 参数为 query.echostr
  if (query.echostr) {
    const echostr = query.echostr;
    const signatureValid = verifyWecomSignature({
      token,
      timestamp,
      nonce,
      encrypt: echostr,
      signature,
    });
    if (!signatureValid) {
      throw new Error("Invalid signature");
    }
    const plaintext = decryptWecomEncrypted({
      encodingAESKey,
      receiveId,
      encrypt: echostr,
    });
    return { type: "verify", echostr: plaintext };
  }

  if (!body?.trim()) {
    throw new Error("Missing request body");
  }

  const encrypt = extractEncryptFromXml(body);
  const signatureValid = verifyWecomSignature({
    token,
    timestamp,
    nonce,
    encrypt,
    signature,
  });
  if (!signatureValid) {
    throw new Error("Invalid signature");
  }

  const decrypted = decryptWecomEncrypted({
    encodingAESKey,
    receiveId,
    encrypt,
  });
  const data = parseXml(decrypted) as Record<string, unknown>;
  return { type: "event", data };
}
