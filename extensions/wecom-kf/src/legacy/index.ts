/**
 * Legacy wecom-cs 模块懒加载入口（Bot/Agent monitor 与出站）。
 *
 * 仅在 `channels.wecom-kf.legacyWecomCsEnabled=true` 时由 gateway / index 加载。
 */

/**
 * 加载 legacy monitor（Bot/Agent webhook 主路径）。
 */
export async function loadLegacyMonitor() {
  return import("./monitor.js");
}

/**
 * 加载 legacy wecom-cs 出站适配器。
 */
export async function loadLegacyOutbound() {
  return import("./outbound-wecom-cs.js");
}

/**
 * 加载 legacy HTTP webhook 处理器。
 */
export async function loadLegacyWebhookHandler() {
  const mod = await loadLegacyMonitor();
  return mod.handleWecomWebhookRequest;
}
