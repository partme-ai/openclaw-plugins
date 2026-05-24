/**
 * @description Prometheus 出站占位：infra 插件不处理 Channel 出站。
 */

/** @description 指标插件不支持 Channel 出站。 @returns 恒为 true */
export function prometheusOutboundUnsupported(): boolean {
  return true;
}
