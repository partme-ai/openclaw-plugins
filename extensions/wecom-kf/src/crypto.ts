/**
 * 企微回调加解密模块
 * 实现企微微信客服回调的签名验证和消息解密
 *
 * 加密方式：AES 256 CBC
 * 企微文档：https://developer.work.weixin.qq.com/document/path/90968
 */

import { createHash, createDecipheriv } from "node:crypto";

/**
 * 验证企微回调签名
 * 签名算法：sha1(sort([token, timestamp, nonce, encrypt]))
 *
 * @param token - 回调配置中的 Token
 * @param timestamp - 回调请求中的 timestamp
 * @param nonce - 回调请求中的 nonce
 * @param encrypt - 加密的消息体
 * @param signature - 请求中的签名
 * @returns 签名是否合法
 */
export function verifySignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  signature: string
): boolean {
  const arr = [token, timestamp, nonce, encrypt].sort();
  const str = arr.join("");
  const hash = createHash("sha1").update(str).digest("hex");
  return hash === signature;
}

/**
 * 解密企微回调消息
 * 使用 AES 256 CBC 解密，密钥由 EncodingAESKey + "=" Base64 解码得到
 *
 * @param encodingAESKey - 回调配置中的 EncodingAESKey（43 字符 Base64）
 * @param encrypt - 加密的消息体
 * @returns 解密后的明文 XML/JSON
 */
export function decryptMessage(
  encodingAESKey: string,
  encrypt: string
): string {
  // EncodingAESKey 是 Base64 编码的 AES Key（43字符 + "="）
  const aesKey = Buffer.from(encodingAESKey + "=", "base64");
  const iv = aesKey.subarray(0, 16);

  const decipher = createDecipheriv("aes-256-cbc", aesKey, iv);
  decipher.setAutoPadding(false);

  const encryptedBuffer = Buffer.from(encrypt, "base64");
  let decrypted = Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final(),
  ]);

  // 去除 PKCS#7 padding
  const pad = decrypted[decrypted.length - 1];
  if (pad > 0 && pad <= 32) {
    decrypted = decrypted.subarray(0, decrypted.length - pad);
  }

  // 消息格式：random(16) + msg_len(4) + msg + corpId
  // 跳过前 16 字节随机数
  const msgLen = decrypted.readUInt32BE(16);
  const msg = decrypted.subarray(20, 20 + msgLen);

  return msg.toString("utf-8");
}

/**
 * 解析企微回调请求
 * 处理 GET（URL 验证）和 POST（消息/事件通知）两种请求
 *
 * @param query - URL 查询参数
 * @param body - POST 请求体
 * @param token - 回调配置中的 Token
 * @param encodingAESKey - 回调配置中的 EncodingAESKey
 * @returns 解密后的消息对象
 */
export function parseWecomCallback(
  query: {
    msg_signature?: string;
    timestamp?: string;
    nonce?: string;
    echostr?: string;
  },
  body: string | null,
  token: string,
  encodingAESKey: string
): { type: "verify"; echostr: string } | { type: "event"; data: Record<string, unknown> } {
  const { msg_signature, timestamp, nonce, echostr } = query;

  // GET 请求：URL 验证（返回解密后的 echostr）
  if (echostr && msg_signature && timestamp && nonce) {
    if (!verifySignature(token, timestamp, nonce, echostr, msg_signature)) {
      throw new Error("[wecom_kf] Signature verification failed for echostr");
    }
    const decrypted = decryptMessage(encodingAESKey, echostr);
    return { type: "verify", echostr: decrypted };
  }

  // POST 请求：消息/事件通知
  if (body && msg_signature && timestamp && nonce) {
    // 从 XML body 提取 Encrypt 字段
    const encryptMatch = body.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
    if (!encryptMatch) {
      throw new Error("[wecom_kf] Missing Encrypt field in callback body");
    }
    const encrypt = encryptMatch[1];

    if (!verifySignature(token, timestamp, nonce, encrypt, msg_signature)) {
      throw new Error("[wecom_kf] Signature verification failed for event");
    }

    const decrypted = decryptMessage(encodingAESKey, encrypt);
    // 解密后的内容是 JSON 或 XML，尝试 JSON 解析
    try {
      return { type: "event", data: JSON.parse(decrypted) };
    } catch {
      // 如果不是 JSON，作为 XML 处理
      return { type: "event", data: { raw: decrypted } };
    }
  }

  throw new Error("[wecom_kf] Invalid callback request: missing required parameters");
}
