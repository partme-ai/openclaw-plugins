import type { OpenClawConfig } from "openclaw/plugin-sdk";

const CHANNEL_ID = "mqtt-ws";

/**
 * 运行态安全的“是否已配置”判断。
 *
 * 该文件刻意不导入 setup-only SDK，避免 Gateway 正常启动时把仅供配置向导使用的
 * 宿主入口打进运行时依赖图。
 */
export function isWebMqttConfigured(cfg: OpenClawConfig): boolean {
  const section = (cfg.channels as Record<string, unknown> | undefined)?.[CHANNEL_ID] as
    | Record<string, unknown>
    | undefined;
  return Boolean(section?.port && section.path);
}
