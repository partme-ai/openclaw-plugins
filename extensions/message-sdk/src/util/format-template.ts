/**
 * @module util/format-template
 *
 * 用户可见文案模板占位符替换 / User-facing template placeholder substitution.
 *
 * **职责**：将 `{key}` 占位符替换为变量值；未知或空值占位符保留原样。
 *
 * **适用场景**：配对码回复、状态栏脚注、可配置提示语等模板化文案。
 *
 * **上下游**：
 * - 上游：通道插件 text-config / footer / pairing 回复构建
 * - 下游：无
 *
 * **关键导出**：`formatTemplate`
 */

/**
 * 替换模板中的 `{key}` 占位符；未知或空值占位符保留原样。
 *
 * 仅匹配 `\w+` 键名（字母数字下划线）；值为 `undefined`、空字符串时保留 `{key}`。
 *
 * @param template - 含 `{key}` 占位符的模板字符串 / Template with `{key}` placeholders
 * @param vars - 键值映射 / Variable map keyed by placeholder name
 * @returns 替换后的文案 / Interpolated string
 *
 * @example
 * ```ts
 * formatTemplate("Hello {name}, code: {code}", { name: "Alice", code: "1234" });
 * // => "Hello Alice, code: 1234"
 * ```
 */
export function formatTemplate(
  template: string,
  vars: Record<string, string | number | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value != null && value !== "" ? String(value) : match;
  });
}
