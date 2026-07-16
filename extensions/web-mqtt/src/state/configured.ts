import type { OpenClawConfig } from "openclaw/plugin-sdk";

const CHANNEL_ID = "mqtt-ws";

/** Runtime-safe configured check that does not load the setup-only SDK surface. */
export function isWebMqttConfigured(cfg: OpenClawConfig): boolean {
  const section = (cfg.channels as Record<string, unknown> | undefined)?.[CHANNEL_ID] as
    | Record<string, unknown>
    | undefined;
  return Boolean(section?.port && section.path);
}
