/**
 * 企微客服消息与事件类型
 * 对应 kf/sync_msg、回调等 API 数据结构
 */

/**
 * 企微客服事件
 */
export interface KfEvent {
  /**
   * 事件类型
   * - enter_session: 客户进入会话
   * - msg_send_fail: 消息发送失败
   * - servicer_status_change: 接待人员状态变更
   * - session_status_change: 会话状态变更
   */
  event_type: string;
  /** 欢迎语 code（enter_session 事件，有效期 20 秒） */
  welcome_code?: string;
  /** 事件响应 code */
  msg_code?: string;
  /**
   * 状态变更类型（session_status_change 事件）
   * 1 = 从接待池接入, 2 = 转接, 3 = 结束, 4 = 重新接入
   */
  change_type?: number;
  /**
   * 消息发送失败类型（msg_send_fail 事件）
   * 4 = 会话已过期, 5 = 会话已关闭, 6 = 超过 5 条限制, 10 = 用户拒收, 12 = 禁发类型
   */
  fail_type?: number;
  /** 接待人员 userid（servicer_status_change 事件） */
  servicer_userid?: string;
  /**
   * 接待人员变更后的状态（servicer_status_change 事件）
   * 1 = 接待中, 2 = 停止接待
   */
  servicer_status?: number;
  /** 场景值（enter_session 事件） */
  scene?: string;
  /** 场景参数 */
  scene_param?: string;
  /** 视频号信息 */
  wechat_channels?: {
    nickname: string;
    scene: number;
  };
}

/**
 * 企微客服消息
 * 来自 kf/sync_msg API
 */
export interface KfMessage {
  /** 消息 ID */
  msgid: string;
  /** 客服账号 ID */
  open_kfid: string;
  /** 客户外部 ID */
  external_userid: string;
  /** 发送时间戳 */
  send_time: number;
  /**
   * 消息来源
   * 3 = 微信客户发送, 4 = 系统事件, 5 = 接待人员发送
   */
  origin: 3 | 4 | 5;
  /** 消息类型 */
  msgtype: string;
  /** 文本消息内容 */
  text?: { content: string };
  /** 图片消息 */
  image?: { media_id: string };
  /** 语音消息 */
  voice?: { media_id: string };
  /** 地理位置消息 */
  location?: {
    name?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  };
  /** 链接消息 */
  link?: {
    title?: string;
    desc?: string;
    url?: string;
    pic_url?: string;
  };
  /** 小程序卡片消息 */
  miniprogram?: {
    title?: string;
    appid?: string;
    pagepath?: string;
    thumb_media_id?: string;
  };
  /** 视频消息 */
  video?: { media_id: string };
  /** 文件消息 */
  file?: { media_id: string };
  /** 事件消息（origin=4 时） */
  event?: KfEvent;
}

/**
 * 消息同步响应
 * 来自 kf/sync_msg API
 */
export interface SyncMsgResponse {
  /** 错误码，0 为成功 */
  errcode: number;
  /** 错误信息 */
  errmsg: string;
  /** 下一次拉取的游标（必须持久化） */
  next_cursor: string;
  /** 是否还有更多消息 */
  has_more: number;
  /** 消息列表 */
  msg_list: KfMessage[];
}

// ─────────────────── Reply 管线类型（与 OpenClaw channel.reply 对齐）───────────────────

export interface AgentRouteParams {
  cfg: Record<string, unknown>;
  channel: string;
  accountId: string;
  peer: { kind: string; id: string };
}

export interface AgentRouteResult {
  agentId: string;
  [key: string]: unknown;
}

export interface InboundContextParams {
  channel: string;
  accountId: string;
  from: string;
  text: string;
  chatType: string;
  extra?: Record<string, unknown>;
}

export interface InboundContext {
  [key: string]: unknown;
}

export interface ReplyDispatcherParams {
  deliver: (payload: { text: string }) => Promise<void>;
}

export interface ReplyDispatcher {
  [key: string]: unknown;
}

export interface DispatchReplyParams {
  ctx: InboundContext;
  cfg: Record<string, unknown>;
  dispatcher: ReplyDispatcher;
  replyOptions: AgentRouteResult;
}

export interface SendTextParams {
  text: string;
  to: string;
  account: import("./config.js").WecomAccountConfig;
}
