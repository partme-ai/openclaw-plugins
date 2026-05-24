/**
 * @file Gotify 传输层 Barrel — WebSocket `/stream` 与相关类型再导出入口。
 *
 * @description Channel Plugin 运行时通过本文件聚合 **入站传输** surface，
 * 避免业务层直接依赖 `ws-listener.ts` 路径造成循环 import / 测试替身注入困难。
 * **模块角色**：传输子系统对外稳定 API 边界（Channel lifecycle · inbound transport）。
 */

export {
  createGotifyWsListener,
  type GotifyWsListenerDeps,
  type GotifyWsListenerController,
} from "./ws-listener.js";
