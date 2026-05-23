/**
 * WeCom 消息类型定义
 * Bot 和 Agent 模式共用
 */

/**
 * Bot 模式入站消息基础结构 (JSON)
 */
/**
 * **WecomBotInboundBase (Bot 入站消息基类)**
 * 
 * Bot 模式下 JSON 格式回调的基础字段。
 * @property msgid 消息 ID
 * @property aibotid 机器人 ID
 * @property chattype 会话类型: "single" | "group"
 * @property chatid 群聊 ID (仅群组时存在)
 * @property response_url 下行回复 URL (用于被动响应转主动推送)
 * @property from 发送者信息
 */
export type WecomBotInboundBase = {
    msgid?: string;
    aibotid?: string;
    chattype?: "single" | "group";
    chatid?: string;
    response_url?: string;
    from?: { userid?: string; corpid?: string };
    msgtype?: string;
    /** 附件数量 (部分消息存在) */
    attachment_count?: number;
};

export type WecomBotInboundText = WecomBotInboundBase & {
    msgtype: "text";
    text?: { content?: string };
    quote?: WecomInboundQuote;
};

export type WecomBotInboundVoice = WecomBotInboundBase & {
    msgtype: "voice";
    voice?: { content?: string };
    quote?: WecomInboundQuote;
};

export type WecomBotInboundVideo = WecomBotInboundBase & {
    msgtype: "video";
    video?: { url?: string; aeskey?: string };
    quote?: WecomInboundQuote;
};

export type WecomBotInboundStreamRefresh = WecomBotInboundBase & {
    msgtype: "stream";
    stream?: { id?: string };
};

export type WecomBotInboundEvent = WecomBotInboundBase & {
    msgtype: "event";
    create_time?: number;
    event?: {
        eventtype?: string;
        [key: string]: unknown;
    };
};

/**
 * **WecomInboundQuote (引用消息)**
 * 
 * 消息中引用的原始内容（如回复某条消息）。
 * 支持引用文本、图片、混合类型、语音、文件等。
 */
export type WecomInboundQuote = {
    msgtype?: "text" | "image" | "mixed" | "voice" | "file" | "video";
    /** 引用文本内容 */
    text?: { content?: string };
    /** 引用图片 URL */
    image?: { url?: string };
    /** 引用混合消息 (图文) */
    mixed?: {
        msg_item?: Array<{
            msgtype: "text" | "image";
            text?: { content?: string };
            image?: { url?: string };
        }>;
    };
    /** 引用语音 */
    voice?: { content?: string };
    /** 引用文件 */
    file?: { url?: string };
    /** 引用视频 */
    video?: { url?: string };
};

export type WecomBotInboundMessage =
    | WecomBotInboundText
    | WecomBotInboundVoice
    | WecomBotInboundVideo
    | WecomBotInboundStreamRefresh
    | WecomBotInboundEvent
    | (WecomBotInboundBase & { quote?: WecomInboundQuote } & Record<string, unknown>);

/**
 * Agent 模式入站消息结构 (解析自 XML)
 */
/**
 * **WecomAgentInboundMessage (Agent 入站消息)**
 * 
 * Agent 模式下解析自 XML 的扁平化消息结构。
 * 键名保持 PascalCase (如 `ToUserName`)。
 */
export type WecomAgentInboundMessage = {
    ToUserName?: string;
    FromUserName?: string;
    CreateTime?: number;
    MsgType?: string;
    MsgId?: string;
    AgentID?: number;
    // 文本消息
    Content?: string;
    // 图片消息
    PicUrl?: string;
    MediaId?: string;
    // 文件消息
    FileName?: string;
    // 语音消息
    Format?: string;
    Recognition?: string;
    // 视频消息
    ThumbMediaId?: string;
    // 位置消息
    Location_X?: number;
    Location_Y?: number;
    Scale?: number;
    Label?: string;
    // 链接消息
    Title?: string;
    Description?: string;
    Url?: string;
    // 事件消息
    Event?: string;
    EventKey?: string;
    // 群聊
    ChatId?: string;
};

/**
 * 模板卡片类型
 */
/**
 * **WecomTemplateCard (模板卡片)**
 * 
 * 复杂的交互式卡片结构。
 * @property card_type 卡片类型: "text_notice" | "news_notice" | "button_interaction" ...
 * @property source 来源信息
 * @property main_title 主标题
 * @property sub_title_text 副标题
 * @property horizontal_content_list 水平排列的键值列表
 * @property button_list 按钮列表
 */
export type WecomTemplateCard = {
    card_type: "text_notice" | "news_notice" | "button_interaction" | "vote_interaction" | "multiple_interaction";
    source?: { icon_url?: string; desc?: string; desc_color?: number };
    main_title?: { title?: string; desc?: string };
    task_id?: string;
    button_list?: Array<{ text: string; style?: number; key: string }>;
    sub_title_text?: string;
    horizontal_content_list?: Array<{
        keyname: string;
        value?: string;
        type?: number;
        url?: string;
        userid?: string;
    }>;
    card_action?: { type: number; url?: string; appid?: string; pagepath?: string };
    action_menu?: { desc: string; action_list: Array<{ text: string; key: string }> };
    select_list?: Array<{
        question_key: string;
        title?: string;
        selected_id?: string;
        option_list: Array<{ id: string; text: string }>;
    }>;
    submit_button?: { text: string; key: string };
    checkbox?: {
        question_key: string;
        option_list: Array<{ id: string; text: string; is_checked?: boolean }>;
        mode?: number;
    };
};

/**
 * 出站消息类型
 */
export type WecomOutboundMessage =
    | { msgtype: "text"; text: { content: string } }
    | { msgtype: "markdown"; markdown: { content: string } }
    | { msgtype: "template_card"; template_card: WecomTemplateCard };

/**
 * **KfMessage (企微客服消息)**
 *
 * 企微客服回调消息结构。
 * 用于处理 kf_msg_or_event 事件中的消息。
 *
 * @property origin 消息来源: 3=客户消息, 4=系统事件, 5=其他
 * @property msgtype 消息类型: "text" | "image" | "event" 等
 * @property openkid 客服账号 ID
 * @property external_userid 外部联系人 UserID
 * @property msgid 消息 ID
 * @property sequence 消息序号
 */
export type KfMessage = {
    /** 消息来源: 3=客户消息, 4=系统事件, 5=其他 */
    origin: number;
    /** 消息类型 */
    msgtype: string;
    /** 客服账号 ID */
    open_kfid?: string;
    /** 外部联系人 UserID */
    external_userid?: string;
    /** 消息 ID */
    msgid?: string;
    /** 消息序号 */
    sequence?: number;
    /** sync_msg 发送时间（秒级 Unix 时间戳） */
    send_time?: number;
    /** 文本内容 */
    text?: { content: string };
    /** 图片信息 */
    image?: { media_id: string };
    /** 事件类型 (系统事件) */
    event?: string;
    [key: string]: unknown;
};

/**
 * OpenClaw 渠道路由请求参数。
 *
 * 当前 wecom-kf 的 ICS 管理接口只透传给 Gateway runtime，因此这里保持
 * 结构化但宽松的类型，避免把内部 Gateway 形状硬编码到插件侧。
 */
export type AgentRouteParams = Record<string, unknown>;

/**
 * OpenClaw 渠道路由结果。
 */
export type AgentRouteResult = Record<string, unknown>;

/**
 * 入站上下文归一化请求参数。
 */
export type InboundContextParams = Record<string, unknown>;

/**
 * 入站上下文归一化结果。
 */
export type InboundContext = Record<string, unknown>;

/**
 * 回复分发器创建参数。
 */
export type ReplyDispatcherParams = Record<string, unknown>;

/**
 * 回复分发器实例。
 */
export type ReplyDispatcher = Record<string, unknown>;

/**
 * 回复分发请求参数。
 */
export type DispatchReplyParams = Record<string, unknown>;

/**
 * 渠道文本发送参数。
 */
export type SendTextParams = {
    cfg?: Record<string, unknown>;
    to: string;
    text: string;
    accountId?: string | null;
    [key: string]: unknown;
};

/**
 * 事件消息配置。
 */
export type EventMessagesConfig = {
    welcome?: {
        enabled?: boolean;
        msgtype?: string;
        content?: Record<string, unknown>;
    };
    ending?: {
        enabled?: boolean;
        msgtype?: string;
        content?: Record<string, unknown>;
    };
    satisfaction?: {
        enabled?: boolean;
        head_content?: string;
        options?: Array<{ id: string; content: string }>;
    };
};
