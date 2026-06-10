/**
 * @module agent/xml
 *
 * 企业微信 Agent 回调 **XML 协议辅助**（不含 AES 运算本身）。
 *
 * **职责**：
 * - 从 POST 密文 XML 中提取 `<Encrypt>` 节点（供 `WecomCrypto.decrypt`）
 * - 提取 `ToUserName`（CorpID）等字段
 * - 构造被动回复用的加密 XML 响应包（Agent 模式通常走 API 主动发送，此处供兼容场景）
 *
 * **加解密分工**：
 * - 本模块：纯字符串/XML 解析与拼装
 * - 验签与 AES：`@wecom/aibot-node-sdk` 的 `WecomCrypto`（见 `agent/webhook.ts`）
 */

/**
 * 从 XML 密文中提取 Encrypt 字段。
 *
 * 支持 CDATA 与普通文本两种 `<Encrypt>` 写法。
 *
 * @param xml - 企微 POST 原始 XML 字符串
 * @returns Base64/AES 密文内容
 * @throws 缺少 Encrypt 节点时
 */
export function extractEncryptFromXml(xml: string): string {
    const match = /<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/s.exec(xml);
    if (!match?.[1]) {
        // 尝试不带 CDATA 的格式
        const altMatch = /<Encrypt>(.*?)<\/Encrypt>/s.exec(xml);
        if (!altMatch?.[1]) {
            throw new Error("Invalid XML: missing Encrypt field");
        }
        return altMatch[1];
    }
    return match[1];
}

/**
 * 从 XML 中提取 ToUserName（通常为 CorpID）。
 *
 * @param xml - 解密前或解密后的 XML
 */
export function extractToUserNameFromXml(xml: string): string {
    const match = /<ToUserName><!\[CDATA\[(.*?)\]\]><\/ToUserName>/s.exec(xml);
    if (!match?.[1]) {
        const altMatch = /<ToUserName>(.*?)<\/ToUserName>/s.exec(xml);
        return altMatch?.[1] ?? "";
    }
    return match[1];
}

/**
 * 构建企微被动回复所需的加密 XML 响应包。
 *
 * @param params.encrypt - AES 加密后的密文
 * @param params.signature - msg_signature
 * @param params.timestamp - 时间戳
 * @param params.nonce - 随机串
 */
export function buildEncryptedXmlResponse(params: {
    encrypt: string;
    signature: string;
    timestamp: string;
    nonce: string;
}): string {
    return `<xml>
<Encrypt><![CDATA[${params.encrypt}]]></Encrypt>
<MsgSignature><![CDATA[${params.signature}]]></MsgSignature>
<TimeStamp>${params.timestamp}</TimeStamp>
<Nonce><![CDATA[${params.nonce}]]></Nonce>
</xml>`;
}
