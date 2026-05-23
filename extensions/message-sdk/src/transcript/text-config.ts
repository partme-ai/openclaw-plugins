/**
 * @module transcript/text-config
 *
 * 渠道用户可见文案：平铺 *Text 配置合并。
 *
 * **职责**：将 openclaw.json 中平铺的 `*Text` 字段（如 `thinkingText`）映射到
 * 内部模板键（如 `thinking`），并与默认值合并，产出渠道运行时文案对象。
 *
 * **适用场景**：WeCom / Feishu 插件初始化 `ChannelStatusTemplates` 时，
 * 账号级 scalar 覆盖由 `mergeChannelAccountConfig` 另行处理。
 *
 * **上下游**：
 * - 上游：openclaw.json 账号 config 平铺字段
 * - 下游：`resolveChannelTemplates`、reply pipeline 状态行更新
 *
 * **关键导出**：`resolveChannelUserTexts`、`ChannelTextKeyMapping`
 */

/**
 * 内部模板键 → openclaw.json 平铺字段名的映射类型。
 *
 * @example
 * ```ts
 * const mapping = { thinking: "thinkingText", tool: "toolText" } satisfies ChannelTextKeyMapping<typeof defaults>;
 * ```
 */
export type ChannelTextKeyMapping<TInternal extends Record<string, string>> = {
  [K in keyof TInternal & string]: string;
};

/**
 * 合并默认文案与平铺 *Text 字段。
 *
 * 仅当 config 中对应字段为非空 string 时才覆盖默认值（trim 后判断）。
 *
 * @typeParam T - 内部模板键记录类型
 * @param defaults - 渠道默认文案
 * @param mapping - 内部键 → config 字段名映射
 * @param cfg - 账号 config 对象（含平铺 *Text 字段）
 * @returns 合并后的文案对象（浅拷贝）
 *
 * @example
 * ```ts
 * const texts = resolveChannelUserTexts(DEFAULT_TEXTS, TEXT_KEY_MAPPING, accountCfg);
 * ```
 */
export function resolveChannelUserTexts<T extends Record<string, string>>(
  defaults: T,
  mapping: ChannelTextKeyMapping<T>,
  cfg: Record<string, unknown>,
): T {
  const resolved = { ...defaults };

  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const configKey = mapping[key];
    const raw = cfg[configKey];
    if (typeof raw === "string") {
      const custom = raw.trim();
      if (custom) {
        resolved[key] = custom as T[keyof T & string];
      }
    }
  }

  return resolved;
}
