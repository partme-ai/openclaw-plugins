/**
 * @fileoverview Prometheus HTTP 传输层入口。
 *
 * @description scrape 鉴权辅助；实际 HTTP 路由在 index.ts 注册。
 *
 * @module transport/server
 */

export { assertScrapeAuthorized } from "../config/scrape-auth.js";
