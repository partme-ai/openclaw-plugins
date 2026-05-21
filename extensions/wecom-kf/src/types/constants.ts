/**
 * WeCom 双模式常量定义
 */

/** 固定 Webhook 路径 */
export const WEBHOOK_PATHS = {
    /** Bot 模式历史兼容路径（不再维护） */
    BOT: "/wecom-cs",
    /** Bot 模式历史备用兼容路径（不再维护） */
    BOT_ALT: "/wecom-cs/bot",
    /** Agent 模式历史兼容路径（不再维护） */
    AGENT: "/wecom-cs/agent",
    /** Bot 模式推荐路径前缀 */
    BOT_PLUGIN: "/plugins/wecom-cs/bot",
    /** Agent 模式推荐路径前缀 */
    AGENT_PLUGIN: "/plugins/wecom-cs/agent",
    /** KF 客服回调路径 */
    KF: "/wecom/kefu",
    KF_PLUGIN: "/plugins/wecom/kefu",
} as const;

/** 企业微信 API 端点 */
export const API_ENDPOINTS = {
    GET_TOKEN: "https://qyapi.weixin.qq.com/cgi-bin/gettoken",
    SEND_MESSAGE: "https://qyapi.weixin.qq.com/cgi-bin/message/send",
    SEND_APPCHAT: "https://qyapi.weixin.qq.com/cgi-bin/appchat/send",
    UPLOAD_MEDIA: "https://qyapi.weixin.qq.com/cgi-bin/media/upload",
    DOWNLOAD_MEDIA: "https://qyapi.weixin.qq.com/cgi-bin/media/get",
    /** KF 客服消息同步 */
    KF_SYNC_MSG: "https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg",
    /** KF 客服消息发送 */
    KF_SEND_MSG: "https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg",
    /** KF 事件消息发送 (欢迎语等) */
    KF_SEND_MSG_ON_EVENT: "https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg_on_event",
} as const;

/** 各类限制常量 */
export const LIMITS = {
    /** 文本消息最大字节数 */
    TEXT_MAX_BYTES: 2048,
    /** Token 刷新缓冲时间 (提前刷新) */
    TOKEN_REFRESH_BUFFER_MS: 60_000,
    /** HTTP 请求超时 */
    REQUEST_TIMEOUT_MS: 15_000,
    /** 最大请求体大小 */
    MAX_REQUEST_BODY_SIZE: 1024 * 1024,
} as const;

/** AES 加密常量 */
export const CRYPTO = {
    /** PKCS#7 块大小 */
    PKCS7_BLOCK_SIZE: 32,
    /** AES Key 长度 */
    AES_KEY_LENGTH: 32,
} as const;
