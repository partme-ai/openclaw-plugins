/**
 * Prometheus 出站占位 — infra 插件无 messaging 出站。
 */

/**
 * 指标插件不处理 Channel 出站；保留 Base Profile 契约占位。
 */
export function prometheusOutboundUnsupported(): boolean {
  return true;
}
