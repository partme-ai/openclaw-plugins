/**
 * @description Prometheus 入站占位：infra 插件不处理 Channel 消息，保留 Base 契约占位。
 */

/** @description 指标插件不支持 Channel 入站；调用方可用于能力探测。 @returns 恒为 true */
export function prometheusInboundUnsupported(): boolean {
  return true;
}
