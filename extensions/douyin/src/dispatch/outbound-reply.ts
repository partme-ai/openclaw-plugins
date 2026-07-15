/**
 * @module dispatch/outbound-reply
 *
 * 抖音生活服务 Webhook Agent 回复语义。
 */

/**
 * 生活服务 Webhook 没有对称回复 API，因此必须返回失败而不是伪造已送达。
 */
export async function deliverDouyinAgentReplyPayload(params: {
  cfg: Record<string, unknown>;
  shopId: string;
  peerId: string;
  text: string;
  mediaUrls?: string[];
  log?: (message: string) => void;
}): Promise<{ ok: boolean; error?: string }> {
  if (!params.text.trim() && (params.mediaUrls?.length ?? 0) === 0) {
    return { ok: false, error: "empty agent reply" };
  }
  params.log?.(
    `[douyin] 未发送 Agent 回复（shop=${params.shopId} peer=${params.peerId}）：生活服务 Webhook 无对称私信 API`,
  );
  return { ok: false, error: "Life Service Webhook does not support symmetric outbound messaging" };
}
