/**
 * @fileoverview Bridge 插件的「冷路径」装配入口。
 *
 * @description
 * 仅供 Base Profile / 工具链在 setup 场景拉取插件定义时使用：只再导出 `plugin-entry`，
 * 避免与 `index.ts` 的大规模 re-export 重复，从而缩短解析链路与 tree-shaking 噪音。
 *
 * @module setup-entry
 */

/**
 * Bridge setup 冷路径：仅导出插件定义，不重复 index 的公开 re-export 面。
 */

/** @description 插件清单默认导出（`id`、`configSchema`、`register`），供 setup 工具链单独解析。 */
export { default } from "./bridge/plugin-entry.js";
