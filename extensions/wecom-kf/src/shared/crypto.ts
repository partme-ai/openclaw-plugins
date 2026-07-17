/**
 * 企业微信客服回调的签名验证与 AES 解密实现。
 *
 * 签名按官方字段排序后计算 SHA-1，并使用固定长度摘要常量时间比较；密文使用协议指定
 * 的 AES-256-CBC 与 32 字节 PKCS#7 填充，解密后还必须校验 receiveId，防止跨企业投递。
 */
import crypto from "node:crypto";

const WECOM_PKCS7_BLOCK_SIZE = 32;

function decodeEncodingAESKey(encodingAESKey: string): Buffer {
  const trimmed = encodingAESKey.trim();
  if (!trimmed) throw new Error("encodingAESKey missing");
  const withPadding = trimmed.endsWith("=") ? trimmed : `${trimmed}=`;
  const decoded = Buffer.from(withPadding, "base64");
  if (decoded.length !== 32) {
    throw new Error(`invalid encodingAESKey (expected 32 bytes, got ${decoded.length})`);
  }
  return decoded;
}

function pkcs7Unpad(buffer: Buffer): Buffer {
  if (buffer.length === 0) throw new Error("invalid pkcs7 payload");
  const pad = buffer[buffer.length - 1];
  if (pad < 1 || pad > WECOM_PKCS7_BLOCK_SIZE || pad > buffer.length) throw new Error("invalid pkcs7 padding");
  for (let i = 1; i <= pad; i += 1) {
    if (buffer[buffer.length - i] !== pad) throw new Error("invalid pkcs7 padding");
  }
  return buffer.subarray(0, buffer.length - pad);
}

export function computeWecomMsgSignature(params: {
  token: string; timestamp: string; nonce: string; encrypt: string;
}): string {
  return crypto.createHash("sha1").update(
    [params.token, params.timestamp, params.nonce, params.encrypt].map(v => String(v ?? "")).sort().join(""),
  ).digest("hex");
}

export function verifyWecomSignature(params: {
  token: string; timestamp: string; nonce: string; encrypt: string; signature: string;
}): boolean {
  const expected = computeWecomMsgSignature({ token: params.token, timestamp: params.timestamp, nonce: params.nonce, encrypt: params.encrypt });
  const signature = params.signature.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(signature)) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}

export function decryptWecomEncrypted(params: {
  encodingAESKey: string; receiveId?: string; encrypt: string;
}): string {
  const aesKey = decodeEncodingAESKey(params.encodingAESKey);
  const iv = aesKey.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
  decipher.setAutoPadding(false);
  const decryptedPadded = Buffer.concat([decipher.update(Buffer.from(params.encrypt, "base64")), decipher.final()]);
  const decrypted = pkcs7Unpad(decryptedPadded);
  if (decrypted.length < 20) throw new Error(`invalid decrypted payload length ${decrypted.length}`);
  const msgLength = decrypted.readUInt32BE(16);
  const msgEnd = 20 + msgLength;
  if (msgEnd > decrypted.length) throw new Error("invalid decrypted msg length");
  const msg = decrypted.subarray(20, msgEnd).toString("utf8");
  const rid = params.receiveId?.trim();
  if (rid) {
    const trailing = decrypted.subarray(msgEnd).toString("utf8");
    if (trailing !== rid) throw new Error("receiveId mismatch");
  }
  return msg;
}
