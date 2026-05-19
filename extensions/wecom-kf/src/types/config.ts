/**
 * 企微客服配置与账号相关类型
 * 对应 openclaw.json channels.wecom-kf 及 API 返回结构
 */

/**
 * 企微客服账号配置
 * 存储在 openclaw.json channels.wecom-kf.accounts 下
 */
export interface WecomAccountConfig {
  /** 企业 ID */
  corpId: string;
  /** 应用 Secret */
  corpSecret: string;
  /** 客服账号 ID */
  openKfId: string;
  /** 回调 Token（用于验签） */
  token: string;
  /** 回调加密 Key（AES 256 CBC） */
  encodingAESKey: string;
  /** 账号级事件消息配置覆盖（可选） */
  eventMessages?: EventMessagesConfig;
}

/**
 * 企微客服账号信息
 * 来自 kf/account/list API
 */
export interface KfAccount {
  /** 客服账号 ID */
  open_kfid: string;
  /** 客服账号名称 */
  name: string;
  /** 客服账号头像 URL */
  avatar: string;
  /** 是否有管理权限 */
  manage_privilege: boolean;
}

/**
 * 接待人员信息
 * 来自 kf/servicer/list API
 */
export interface ServicerInfo {
  /** 企微用户 ID */
  userid: string;
  /**
   * 接待状态
   * 注意：servicer/list 中 0=接待中、1=停止接待
   */
  status: number;
}

/**
 * 事件消息配置
 * 控制欢迎语、结束语、满意度评价的内容
 * 支持渠道级默认 + 账号级覆盖
 */
export interface EventMessagesConfig {
  /** 欢迎语配置 */
  welcome?: {
    enabled: boolean;
    msgtype: "text" | "msgmenu";
    content: Record<string, unknown>;
  };
  /** 结束语配置 */
  ending?: {
    enabled: boolean;
    msgtype: "text" | "msgmenu";
    content: Record<string, unknown>;
  };
  /** 满意度评价配置 */
  satisfaction?: {
    enabled: boolean;
    head_content: string;
    options: Array<{ id: string; content: string }>;
  };
}

/**
 * 账号映射信息（运行时缓存）
 * open_kfid → Agent 等
 */
export interface AccountMapping {
  name: string;
  avatar: string;
  agentId: string;
}
