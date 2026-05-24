/**
 * @module bot-config-normalize
 *
 * 将历史嵌套 `channels.wecom.bot.*` / `accounts.<id>.bot.*` 配置规范化为运行时平铺字段。
 * 平铺字段优先于嵌套 `bot` 同名字段；`agent` 嵌套结构不受影响。
 */

import type { WecomBotConfig } from "../types/config.js";

/** 嵌套 bot.dm 结构（历史配置） */
type WecomBotDmConfig = {
  policy?: WecomBotConfig["dmPolicy"];
  allowFrom?: Array<string | number>;
  /** 历史别名，等价于 allowFrom */
  allow?: Array<string | number>;
};

type WecomBotNestedConfig = WecomBotConfig & {
  dm?: WecomBotDmConfig;
  /** 历史别名，映射到 streamPlaceholderText */
  streamPlaceholderContent?: string;
  welcomeText?: string;
};

const BOT_FLAT_KEYS = [
  "botId",
  "secret",
  "connectionMode",
  "token",
  "encodingAESKey",
  "receiveId",
  "aibotid",
  "botIds",
  "websocketUrl",
  "welcomeText",
  "sendThinkingMessage",
  "streamPlaceholderText",
  "dmPolicy",
  "allowFrom",
] as const;

/**
 * 将嵌套 `bot` 块与顶层平铺字段合并为运行时使用的平铺配置。
 *
 * 优先级：顶层平铺 > 嵌套 `bot.*`。
 * 别名：`streamPlaceholderContent` → `streamPlaceholderText`；`bot.dm.policy` → `dmPolicy`；
 * `bot.dm.allowFrom` / `bot.dm.allow` → `allowFrom`。
 *
 * @param source 原始账号或顶层 channels.wecom 片段
 * @returns 去掉 `bot` 键、字段已平铺的对象（供 mergeChannelAccountConfig 使用）
 */
export function flattenWecomBotFields(
  source: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }

  const { bot: nestedBot, streamPlaceholderContent, ...rest } = source as Record<
    string,
    unknown
  > & {
    bot?: WecomBotNestedConfig;
    streamPlaceholderContent?: string;
  };

  const fromNestedBot = extractBotFlatFields(nestedBot);
  const merged: Record<string, unknown> = { ...fromNestedBot, ...rest };

  applyStreamPlaceholderAlias(merged, streamPlaceholderContent);
  applyStreamPlaceholderAlias(merged, nestedBot?.streamPlaceholderContent);

  return merged;
}

/**
 * 从嵌套 bot 对象提取可映射到 WeComConfig 平铺字段的值。
 */
function extractBotFlatFields(bot: WecomBotNestedConfig | undefined): Record<string, unknown> {
  if (!bot || typeof bot !== "object" || Array.isArray(bot)) {
    return {};
  }

  const flat: Record<string, unknown> = {};

  for (const key of BOT_FLAT_KEYS) {
    const value = (bot as Record<string, unknown>)[key];
    if (value !== undefined) {
      flat[key] = value;
    }
  }

  applyStreamPlaceholderAlias(flat, bot.streamPlaceholderContent);

  const dm = bot.dm;
  if (dm && typeof dm === "object" && !Array.isArray(dm)) {
    if (dm.policy !== undefined && flat.dmPolicy === undefined) {
      flat.dmPolicy = dm.policy;
    }
    const allowFrom = dm.allowFrom ?? dm.allow;
    if (allowFrom !== undefined && flat.allowFrom === undefined) {
      flat.allowFrom = allowFrom;
    }
  }

  return flat;
}

/**
 * 将 streamPlaceholderContent 写入 streamPlaceholderText（仅当后者未设置）。
 */
function applyStreamPlaceholderAlias(
  target: Record<string, unknown>,
  streamPlaceholderContent: string | undefined,
): void {
  if (
    streamPlaceholderContent !== undefined &&
    streamPlaceholderContent !== "" &&
    target.streamPlaceholderText === undefined
  ) {
    target.streamPlaceholderText = streamPlaceholderContent;
  }
}
