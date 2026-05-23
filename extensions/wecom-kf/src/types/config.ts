/**
 * WeCom 双模式配置类型定义
 */

/** DM 策略配置 - 与其他渠道保持一致，仅用 allowFrom */
export type WecomDmConfig = {
    /** DM 策略: 'open' 允许所有人, 'pairing' 需要配对, 'allowlist' 仅允许列表, 'disabled' 禁用 */
    policy?: 'open' | 'pairing' | 'allowlist' | 'disabled';
    /** 允许的用户列表，为空表示允许所有人 */
    allowFrom?: Array<string | number>;
};

/** 媒体处理配置 */
export type WecomMediaConfig = {
    tempDir?: string;
    retentionHours?: number;
    cleanupOnStart?: boolean;
    maxBytes?: number;
};

/** 网络配置 */
export type WecomNetworkConfig = {
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
    /**
     * 出口代理（用于企业可信 IP 固定出口场景）。
     * 示例: "http://proxy.company.local:3128"
     */
    egressProxyUrl?: string;
};

/** 路由行为配置 */
export type WecomRoutingConfig = {
    /**
     * 当路由未命中 bindings（matchedBy=default）时是否拒绝继续处理。
     * - true: fail-closed（推荐于多账号）
     * - false: 允许回退默认 agent（历史兼容）
     */
    failClosedOnDefaultRoute?: boolean;
};

/**
 * Bot 模式配置 (智能体)
 * 用于接收 JSON 格式回调 + 流式回复
 */
export type WecomBotConfig = {
    /** 智能机器人 ID（用于 Matrix 模式二次身份确认，webhook 模式） */
    aibotid?: string;
    /** 回调 Token (企微后台生成，webhook 模式必填) */
    token?: string;
    /** 回调加密密钥 (企微后台生成，webhook 模式必填) */
    encodingAESKey?: string;
    /**
     * BotId 列表（可选，用于审计与告警）。
     * - 回调路由优先由 URL + 签名决定；botIds 不参与强制拦截。
     * - 当解密后的 aibotid 不在 botIds 中时，仅记录告警日志。
     */
    botIds?: string[];
    /** 接收者 ID (可选，用于解密校验) */
    receiveId?: string;
    /** 流式消息占位符 */
    streamPlaceholderContent?: string;
    /** 欢迎语 */
    welcomeText?: string;
    /** DM 策略 */
    dm?: WecomDmConfig;

    // --- 长链接模式 (WebSocket) ---

    /** 连接模式：webhook（默认）或 websocket */
    connectionMode?: 'webhook' | 'websocket';
    /** 机器人 BotID（websocket 模式必填，企微后台获取） */
    botId?: string;
    /** 机器人 Secret（websocket 模式必填，企微后台获取） */
    secret?: string;
};

/**
 * Agent 模式配置 (自建应用)
 * 用于接收 XML 格式回调 + API 主动发送
 */
export type WecomAgentConfig = {
    /** 企业 ID */
    corpId: string;
    /** 应用 Secret */
    corpSecret: string;
    /** 企微 OpenAPI 基础 URL（KF 可选覆盖） */
    apiBaseUrl?: string;
    /** 应用 ID（可选；不填时可接收回调，但主动发送需具备该字段） */
    agentId?: number | string;
    /** 回调 Token (企微后台「设置API接收」) */
    token: string;
    /** 回调加密密钥 (企微后台「设置API接收」) */
    encodingAESKey: string;
    /** 欢迎语 */
    welcomeText?: string;
    /** DM 策略 */
    dm?: WecomDmConfig;
};

/** 动态 Agent 配置 */
export type WecomDynamicAgentsConfig = {
    /** 是否启用动态 Agent */
    enabled?: boolean;
    /** 私聊：是否为每个用户创建独立 Agent */
    dmCreateAgent?: boolean;
    /** 群聊：是否启用动态 Agent */
    groupEnabled?: boolean;
    /** 管理员列表（绕过动态路由，使用主 Agent） */
    adminUsers?: string[];
};

/**
 * 顶层 WeCom 配置
 * 通过 bot / agent 字段隐式指定模式
 */
export type WecomConfig = {
    /** 是否启用 */
    enabled?: boolean;
    /** Bot 模式配置 (智能体) */
    bot?: WecomBotConfig;
    /** Agent 模式配置 (自建应用) */
    agent?: WecomAgentConfig;
    /**
     * 多账号配置（每个账号可包含 bot + agent，作为一组）。
     * accountId 用于与 OpenClaw `bindings[].match.accountId` 对齐，从而把不同 WeCom 账号路由到不同 OpenClaw agent。
     */
    accounts?: Record<string, WecomAccountConfig>;
    /** 默认账号（可选） */
    defaultAccount?: string;
    /** 媒体处理配置 */
    media?: WecomMediaConfig;
    /** 网络配置 */
    network?: WecomNetworkConfig;
    /** 路由配置 */
    routing?: WecomRoutingConfig;
    /** 动态 Agent 配置 */
    dynamicAgents?: WecomDynamicAgentsConfig;
    /** 出站本地媒体 Path Guard 额外白名单根目录 */
    mediaLocalRoots?: string[];
};

/**
 * 微信客服（KF）单账号配置
 * 位于 channels.wecom-kf.accounts.{accountKey}
 */
export type WecomKfAccountConfig = {
    enabled?: boolean;
    name?: string;
    /** 自定义 KF 回调路径（默认 /wecom-kf 或 /wecom-kf/{accountId}） */
    webhookPath?: string;
    /** 企微 OpenAPI 基础 URL（默认 https://qyapi.weixin.qq.com） */
    apiBaseUrl?: string;
    /** Legacy wecom-cs bot/agent 子配置（历史路径，与 KF 字段可共存） */
    bot?: WecomBotConfig;
    agent?: WecomAgentConfig;
    /** 企微客服账号 open_kfid（必填） */
    openKfId?: string;
    /** 绑定的 OpenClaw Agent id（必填） */
    agentId?: string;
    /** 可选：接待人员 userid → Agent id 覆盖 */
    agentMapping?: Record<string, string>;
    corpId?: string;
    corpSecret?: string;
    token?: string;
    encodingAESKey?: string;
    servicerUserId?: string;
    welcomeText?: string;
};

/**
 * 微信客服（KF）渠道顶层配置
 * channels.wecom-kf — 独立于 wecom / wecom-cs
 */
export type WecomKfConfig = {
    enabled?: boolean;
    defaultAccount?: string;
    /** 顶层 KF 回调路径（可被 accounts.*.webhookPath 覆盖） */
    webhookPath?: string;
    /** 企微 OpenAPI 基础 URL（默认 https://qyapi.weixin.qq.com） */
    apiBaseUrl?: string;
    accounts?: Record<string, WecomKfAccountConfig>;
    /** Legacy wecom-cs 顶层 bot/agent（历史单账号路径） */
    bot?: WecomBotConfig;
    agent?: WecomAgentConfig;
    /** Legacy 单账号顶层字段（与 accounts.default 合并） */
    openKfId?: string;
    agentId?: string;
    agentMapping?: Record<string, string>;
    corpId?: string;
    corpSecret?: string;
    token?: string;
    encodingAESKey?: string;
    welcomeText?: string;
    media?: WecomMediaConfig;
    network?: WecomNetworkConfig;
    routing?: WecomRoutingConfig;
};

/** Matrix 账号条目 */
export type WecomAccountConfig = {
    enabled?: boolean;
    name?: string;
    /** KF 自定义回调路径 */
    webhookPath?: string;
    /** 企微 OpenAPI 基础 URL */
    apiBaseUrl?: string;
    bot?: WecomBotConfig;
    agent?: WecomAgentConfig;
    /** KF 客服模式配置（嵌套写法，与顶层 KF 字段二选一） */
    kf?: {
        openKfId?: string;
        token?: string;
        encodingAESKey?: string;
        corpId?: string;
        corpSecret?: string;
        servicerUserId?: string;
        welcomeText?: string;
        agentId?: string;
        agentMapping?: Record<string, string>;
    };
    /** KF 快捷字段 (兼容 callback.ts 直接读取) */
    corpId?: string;
    corpSecret?: string;
    openKfId?: string;
    /** OpenClaw Agent id（KF 一账号一智能体） */
    agentId?: string;
    agentMapping?: Record<string, string>;
    welcomeText?: string;
    token?: string;
    encodingAESKey?: string;
};
