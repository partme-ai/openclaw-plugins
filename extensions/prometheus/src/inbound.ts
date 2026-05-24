/**
 * Prometheus 入站占位 — infra 插件无 messaging 入站。
 */

/**
 * 指标插件不处理 Channel 入站；保留 Base Profile 契约占位。
 */
export function prometheusInboundUnsupported(): boolean {
  return true;
}
