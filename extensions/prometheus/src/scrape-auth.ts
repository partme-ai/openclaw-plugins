/**
 * Prometheus 抓取端点的 Bearer 鉴权（企业部署可选）
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ResolvedPrometheusConfig } from "./plugin-config.js";

/**
 * 校验 Authorization: Bearer；未通过则写入响应并返回 false。
 *
 * @param req - HTTP 请求
 * @param res - HTTP 响应
 * @param cfg - 解析后的插件配置
 * @returns 是否允许继续处理业务 handler
 */
export function assertScrapeAuthorized(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: ResolvedPrometheusConfig,
): boolean {
  if (!cfg.scrapeAuthEnabled) {
    return true;
  }

  if (!cfg.scrapeBearerToken) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "openclaw-prometheus: scrapeAuth.enabled but no bearer token (set openclaw-prometheus_BEARER_TOKEN or plugins.entries.openclaw-prometheus.config.scrapeAuth.bearerToken for dev only)\n",
    );
    return false;
  }

  const auth = req.headers.authorization?.trim() ?? "";
  const expected = `Bearer ${cfg.scrapeBearerToken}`;
  if (auth !== expected) {
    res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Unauthorized\n");
    return false;
  }

  return true;
}
