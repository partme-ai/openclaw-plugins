/**
 * @module ingress/active-reply-store
 *
 * ActiveReplyStore — 主动回复地址存储（渠道无关）。
 *
 * **职责**：将 streamId 与 IM 平台下发的 `response_url`（及可选 `proxyUrl`）关联，
 * 支持 once（一次性销毁）/ multi（可多次推送）两种使用策略。
 *
 * **适用场景**：企业微信 / 飞书等「先 ACK 再异步推送」的流式回复链路；
 * 常与 `StreamSessionMonitor.activeReplyStore` 一并 prune。
 *
 * **上下游**：
 * - 上游：Webhook 回调解析出的 response_url
 * - 下游：出站 HTTP 客户端通过 `use()` 消费 URL 发送主动消息
 *
 * **关键导出**：`ActiveReplyStore`、`ACTIVE_REPLY_LIMITS`、`ActiveReplyState`
 */

/** ActiveReply 过期时间常量（1 小时） */
export const ACTIVE_REPLY_LIMITS = {
  /** response_url 记录在内存中的 TTL（毫秒） */
  ACTIVE_REPLY_TTL_MS: 60 * 60 * 1000,
} as const;

/**
 * 主动回复地址状态。
 *
 * 与单个 streamId 绑定的平台回调 URL 及使用元数据。
 */
export type ActiveReplyState = {
  /** 平台提供的回调回复 URL */
  response_url: string;
  /** 可选代理地址（企业内网 egress 场景） */
  proxyUrl?: string;
  /** 创建时间戳（用于 TTL prune） */
  createdAt: number;
  /** 首次使用时间（policy="once" 时有意义） */
  usedAt?: number;
  /** 最后一次发送失败的错误信息 */
  lastError?: string;
};

/**
 * **ActiveReplyStore（主动回复地址存储）**
 *
 * 关联 streamId 与 response_url，支持 once / multi 使用策略。
 *
 * @remarks
 * - `once`：URL 仅可使用一次，重复 `use()` 抛错（防止平台侧重复推送）
 * - `multi`：允许多次 `use()`，适用于分片流式推送
 */
export class ActiveReplyStore {
  private activeReplies = new Map<string, ActiveReplyState>();

  /**
   * @param policy - 使用策略：`"once"`（默认，销毁式）或 `"multi"`
   */
  constructor(private policy: "once" | "multi" = "once") {}

  /**
   * 关联 streamId 与 response_url。
   *
   * @param streamId - 流式会话 ID
   * @param responseUrl - 平台下发的主动回复 URL；空则忽略
   * @param proxyUrl - 可选 HTTP 代理 URL
   */
  store(streamId: string, responseUrl?: string, proxyUrl?: string): void {
    const url = responseUrl?.trim();
    if (!url) return;
    this.activeReplies.set(streamId, { response_url: url, proxyUrl, createdAt: Date.now() });
  }

  /**
   * 获取指定 streamId 关联的 response_url。
   *
   * @param streamId - 流式会话 ID
   * @returns response_url，未存储时 undefined
   */
  getUrl(streamId: string): string | undefined {
    return this.activeReplies.get(streamId)?.response_url;
  }

  /**
   * 获取关联的代理 URL。
   *
   * @param streamId - 流式会话 ID
   * @returns proxyUrl，未配置时 undefined
   */
  getProxyUrl(streamId: string): string | undefined {
    return this.activeReplies.get(streamId)?.proxyUrl;
  }

  /**
   * 使用存储的 response_url 执行操作。
   *
   * policy="once" 时第二次调用会抛错，防止平台 URL 被重复消费。
   *
   * @param streamId - 流式会话 ID
   * @param fn - 消费 URL 的异步回调（发送 HTTP 主动消息等）
   * @returns fn 的 Promise 结果
   * @throws {Error} policy="once" 且 URL 已使用时
   * @throws 透传 fn 抛出的错误（同时写入 state.lastError）
   */
  async use(
    streamId: string,
    fn: (params: { responseUrl: string; proxyUrl?: string }) => Promise<void>,
  ): Promise<void> {
    const state = this.activeReplies.get(streamId);
    if (!state?.response_url) {
      return;
    }

    // once 策略：已 usedAt 则拒绝二次消费，避免 IM 平台侧重复 ACK
    if (this.policy === "once" && state.usedAt) {
      throw new Error(`response_url already used for stream ${streamId} (Policy: once)`);
    }

    try {
      await fn({ responseUrl: state.response_url, proxyUrl: state.proxyUrl });
      state.usedAt = Date.now();
    } catch (err: unknown) {
      state.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * 清理超过 TTL 的 active reply 记录。
   *
   * 定期调用以防止 Map 无限增长；TTL 见 {@link ACTIVE_REPLY_LIMITS.ACTIVE_REPLY_TTL_MS}。
   *
   * @param now - 当前时间戳，默认 `Date.now()`
   */
  prune(now: number = Date.now()): void {
    const cutoff = now - ACTIVE_REPLY_LIMITS.ACTIVE_REPLY_TTL_MS;
    for (const [id, state] of this.activeReplies.entries()) {
      if (state.createdAt < cutoff) {
        this.activeReplies.delete(id);
      }
    }
  }
}
