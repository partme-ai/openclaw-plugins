/**
 * Gotify 配置与消息类型定义。
 *
 * 本文件集中声明插件内部共享的结构化类型，避免 transport、channel、setup
 * 层各自重复描述 Gotify message、application、client 与运行态字段。
 * 类型命名保持两层边界：
 * - `Gotify*`：Gotify 官方 API 或配置语义。
 * - `Resolved*`：OpenClaw 插件已经合并默认值后的运行时语义。
 */

/** WebSocket `/stream` 监听相关配置。 */
export interface GotifyStreamConfig {
  /** 是否启用 Gotify -> OpenClaw 的 WebSocket 入站监听。 */
  enabled?: boolean;
  /** 首次断线后的重连延迟，单位毫秒。 */
  reconnectDelayMs?: number;
  /** 指数退避重连的最大延迟，单位毫秒。 */
  maxReconnectDelayMs?: number;
  /** 最大重连次数；达到上限后 listener 会停止并上报 lastError。 */
  maxReconnectAttempts?: number;
  /** 入站派发成功后从 Gotify 删除消息；开发/测试可设为 false 便于在 Gotify App 对照 */
  deleteAfterConsume?: boolean;
}

/** 自动 bootstrap Gotify Application 的配置。 */
export interface GotifyBootstrapConfig {
  /** 是否启用 bootstrap 流程；未启用时 bootstrap helper 会拒绝执行。 */
  enabled?: boolean;
  /** 目标 Application 不存在时是否自动创建。 */
  autoCreateApplication?: boolean;
  /** 查找或创建的 Application 名称。 */
  applicationName?: string;
  /** 自动创建 Application 时写入 Gotify 的描述。 */
  applicationDescription?: string;
}

/** Gotify 入站消息的 DM 安全策略。 */
export type GotifyDmPolicy = "open" | "allowlist" | "pairing" | "disabled";

/** 单个 Gotify 账号的原始配置，来自 `channels.gotify` 或 `accounts.<id>`。 */
export interface GotifyAccountConfig {
  /** 是否启用该账号；禁用账号不会启动 gateway listener。 */
  enabled?: boolean;
  /** UI/CLI 中显示的账号名称。 */
  name?: string;
  /** Gotify Server base URL，例如 `https://gotify.example.com`。 */
  serverUrl?: string;
  /** Application token，用于 `POST /message` 发送消息。 */
  appToken?: string;
  /** Client token，用于 `/stream`、Application API 与 Client API。 */
  clientToken?: string;
  /** 发送消息时没有显式 priority 的默认优先级。 */
  defaultPriority?: number;
  /** 入站消息的 DM 访问策略。 */
  dmPolicy?: GotifyDmPolicy;
  /** allowlist 条目，可匹配 peerId 或 appid。 */
  allowFrom?: Array<string | number>;
  /** WebSocket 入站监听配置。 */
  inbound?: GotifyStreamConfig;
  /** Application bootstrap 配置。 */
  bootstrap?: GotifyBootstrapConfig;
}

/** 渠道级配置；在单账号字段之外增加多账号表和默认账号指针。 */
export interface GotifyChannelConfig extends GotifyAccountConfig {
  /** 多账号模式下未指定账号时使用的账号 ID。 */
  defaultAccount?: string;
  /** 多账号配置表，键为 accountId。 */
  accounts?: Record<string, GotifyAccountConfig>;
}

/** 已解析的账号配置，所有默认值已经补齐，供运行时直接消费。 */
export interface ResolvedGotifyAccount {
  /** OpenClaw 内部账号 ID。 */
  accountId: string;
  /** 展示名称；未配置时回退为 accountId。 */
  name: string;
  /** 账号是否启用。 */
  enabled: boolean;
  /** 是否具备最小出站配置，即 serverUrl + appToken。 */
  configured: boolean;
  /** Gotify Server base URL，未配置时为 null。 */
  serverUrl: string | null;
  /** Application token，未配置时为 null。 */
  appToken: string | null;
  /** Client token，未配置时为 null。 */
  clientToken: string | null;
  /** 规范化后的默认优先级。 */
  defaultPriority: number;
  /** 规范化后的 DM 策略。 */
  dmPolicy: GotifyDmPolicy;
  /** 规范化后的 allowlist。 */
  allowFrom: string[];
  /** 必填形式的 WebSocket 入站配置。 */
  inbound: Required<GotifyStreamConfig>;
  /** 必填形式的 bootstrap 配置。 */
  bootstrap: Required<GotifyBootstrapConfig>;
}

/** `POST /message` 的请求载荷。 */
export interface GotifyMessagePayload {
  /** 消息正文。 */
  message: string;
  /** Gotify 消息标题。 */
  title?: string;
  /** Gotify 消息优先级。 */
  priority?: number;
  /** Gotify extras，支持 client::display、client::notification 和 openclaw metadata。 */
  extras?: Record<string, unknown>;
}

/** Gotify Message API 和 WebSocket stream 返回的消息结构。 */
export interface GotifyMessageResponse {
  /** Gotify 消息 ID。 */
  id: number | string;
  /** 发送该消息的 Gotify Application ID。 */
  appid?: number | string;
  /** 消息标题。 */
  title?: string;
  /** 消息正文。 */
  message?: string;
  /** 消息优先级。 */
  priority?: number;
  /** 消息扩展字段。 */
  extras?: Record<string, unknown>;
  /** Gotify 服务端生成的时间戳字符串。 */
  date?: string;
}

/** Gotify Application API 返回的应用信息。 */
export interface GotifyApplicationInfo {
  /** Application ID。 */
  id: number;
  /** Application 名称。 */
  name: string;
  /** Application 描述。 */
  description?: string;
  /** Application token；部分 API 响应会返回。 */
  token?: string;
  /** 是否为 Gotify 内部应用，内部应用通常不可删除。 */
  internal?: boolean;
}

/** Gotify Client API 返回的客户端信息。 */
export interface GotifyClientInfo {
  /** Client ID。 */
  id: number;
  /** Client 名称。 */
  name?: string;
  /** Client token；创建或列表 API 可能返回。 */
  token?: string;
}

/** operator 诊断报告，供 doctor endpoint 或 CLI 展示。 */
export interface GotifyDoctorReport {
  /** 总体是否通过。 */
  ok: boolean;
  /** 当前检查的 Gotify serverUrl。 */
  serverUrl: string | null;
  /** 是否配置 Application token。 */
  hasAppToken: boolean;
  /** 是否配置 Client token。 */
  hasClientToken: boolean;
  /** `/health` 是否可访问。 */
  healthOk: boolean;
  /** Application API 是否完成检查。 */
  applicationsChecked: boolean;
  /** Client API 是否完成检查。 */
  clientsChecked: boolean;
  /** 诊断过程中发现的问题。 */
  errors: string[];
}

/** Gotify 分页消息列表响应。 */
export interface GotifyPagedMessages {
  /** 当前页消息。 */
  messages: GotifyMessageResponse[];
  /** Gotify 游标分页信息。 */
  paging: {
    /** 当前页大小。 */
    size: number;
    /** 请求限制条数。 */
    limit: number;
    /** 下一页链接；没有下一页时为 null。 */
    next: string | null;
    /** 当前 since 游标。 */
    since: number;
  };
}

/** WebSocket stream 消息；event 为部分服务端事件可能携带的附加字段。 */
export interface GotifyStreamEnvelope extends GotifyMessageResponse {
  /** Gotify stream 事件类型。 */
  event?: string;
}

/** 插件运行态快照，保存于内存 Map 并通过 status endpoint 暴露。 */
export interface GotifyRuntimeSnapshot {
  /** 账号 listener 当前是否运行。 */
  running: boolean;
  /** 最近一次启动时间戳。 */
  lastStartAt: number | null;
  /** 最近一次停止时间戳。 */
  lastStopAt: number | null;
  /** 最近一次运行错误。 */
  lastError: string | null;
  /** 最近一次成功处理入站消息的时间戳。 */
  lastInboundAt: number | null;
  /** 最近一次成功发送出站消息的时间戳。 */
  lastOutboundAt: number | null;
}
