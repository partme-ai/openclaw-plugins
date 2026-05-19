/**
 * 简易抓取端：对运行中的 Gateway 插件 HTTP 路由发起 GET，用于联调验证。
 *
 * 用法：
 *   pnpm run test:client -- http://127.0.0.1:18789/metrics
 *   openclaw-prometheus_BEARER_TOKEN=secret pnpm run test:client -- http://127.0.0.1:18789/metrics
 */

import { get } from "node:http";
import { URL } from "node:url";

function fetchText(target: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const req = get(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function main(): Promise<void> {
  const target = process.argv[2] ?? "http://127.0.0.1:18789/metrics";
  const headers: Record<string, string> = {};
  const token = process.env.openclaw-prometheus_BEARER_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  console.log(`GET ${target}`);
  if (token) {
    console.log("(Authorization: Bearer from openclaw-prometheus_BEARER_TOKEN)");
  }

  const { status, body } = await fetchText(target, headers);
  console.log(`status ${status}`);
  const preview = body.length > 4000 ? `${body.slice(0, 4000)}\n... (${body.length} bytes total)` : body;
  console.log(preview);
  if (status >= 400) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
