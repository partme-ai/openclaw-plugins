/**
 * Message SDK 包根入口，只转出编译后的公共 API 门面。
 * 具体实现与导出白名单位于 `src/index.ts`，此处不应引入运行时副作用。
 */
export * from "./src/index.js";
