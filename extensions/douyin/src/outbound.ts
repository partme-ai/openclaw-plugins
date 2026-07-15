/**
 * 抖音生活服务 Webhook 不提供对称私信发送能力。
 */

/**
 * 明确拒绝不受支持的通用渠道出站，避免向调用方返回假成功。
 */
export async function sendDouyinOutboundUnsupported(): Promise<never> {
  throw new Error(
    "[douyin] generic outbound messaging is unavailable for the Life Service Webhook; use a supported OpenAPI tool",
  );
}
