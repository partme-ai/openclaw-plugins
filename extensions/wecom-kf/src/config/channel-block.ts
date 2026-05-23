/**
 * channels.wecom-kf 配置块解析（含 wecom-cs 读时兼容别名）
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { WecomKfConfig } from "../types/index.js";

/** wecom-kf 渠道 ID，与 OpenClaw bindings.match.channel 对齐 */
export const WECOM_KF_CHANNEL_ID = "wecom-kf";

/** 已废弃的配置键，读时兼容 */
export const LEGACY_WECOM_CS_CHANNEL_KEY = "wecom-cs";

let wecomCsChannelDeprecationWarned = false;

/**
 * 对仍使用 channels.wecom-cs 的配置打印一次性弃用警告。
 */
export function warnWecomCsChannelDeprecation(log?: (message: string) => void): void {
    if (wecomCsChannelDeprecationWarned) return;
    wecomCsChannelDeprecationWarned = true;
    const message =
        "[wecom-kf] channels.wecom-cs is deprecated; migrate to channels.wecom-kf";
    if (log) {
        log(message);
    } else {
        console.warn(message);
    }
}

/**
 * 读取 wecom-kf 渠道配置块：优先 channels.wecom-kf，回退 channels.wecom-cs（弃用别名）。
 */
export function getWecomKfChannelBlock(
    cfg: OpenClawConfig | undefined,
    log?: (message: string) => void,
): WecomKfConfig | undefined {
    if (!cfg?.channels) return undefined;
    const primary = cfg.channels[WECOM_KF_CHANNEL_ID] as WecomKfConfig | undefined;
    if (primary) return primary;
    const legacy = cfg.channels[LEGACY_WECOM_CS_CHANNEL_KEY] as WecomKfConfig | undefined;
    if (legacy) {
        warnWecomCsChannelDeprecation(log);
        return legacy;
    }
    return undefined;
}
