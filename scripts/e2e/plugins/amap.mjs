/** AMap capability 的正式 tarball → Agent Tool → 本地协议夹具闭环。 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { OPENCLAW_BIN, PROFILE } from "../lib/utils.mjs";
import { runAdapterTest } from "./_context.mjs";

const execFileAsync = promisify(execFile);

async function runAgent() {
  const { stdout, stderr } = await execFileAsync(
    OPENCLAW_BIN,
    [
      "--profile", PROFILE,
      "agent",
      "--agent", "main",
      "--session-key", "agent:main:amap-e2e",
      "--message", "AMAP_E2E_TOOL_CALL：请搜索咖啡馆",
      "--timeout", "60",
      "--json",
    ],
    { env: { ...process.env, NO_COLOR: "1" }, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
  );
  return `${stdout}\n${stderr}`;
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
export async function testAmap(ctx, results) {
  await runAdapterTest(
    ctx,
    "amap",
    async () => {
      const model = ctx.modelFixture;
      const provider = ctx.amapProvider;
      if (!model || !provider) throw new Error("AMap E2E requires model and local AMap fixtures");

      const completionsBefore = model.metrics.completions;
      const output = await runAgent();
      if (!output.includes("openclaw e2e fixture reply")) {
        throw new Error("AMap Agent Turn did not finish after tool execution");
      }
      if (model.metrics.completions !== completionsBefore + 2) {
        throw new Error("AMap Agent Turn did not perform exactly one tool-call round trip");
      }
      if (provider.metrics.requests !== 2) {
        throw new Error(`AMap safe GET retry count mismatch: ${provider.metrics.requests}`);
      }
      const query = provider.metrics.lastRequest?.query ?? {};
      if (
        provider.metrics.lastRequest?.pathname !== "/v5/place/text" ||
        query.key !== "amap-e2e-web-service-key" ||
        query.keywords !== "咖啡" ||
        query.output !== "JSON"
      ) {
        throw new Error("AMap tool did not forward the bounded path and configured parameters");
      }
      const finalModelRequest = JSON.stringify(model.metrics.lastRequest);
      if (!finalModelRequest.includes("OpenClaw E2E 咖啡馆")) {
        throw new Error("AMap tool result was not returned to the model transcript");
      }
    },
    {
      service: "local AMap v5 protocol fixture + OpenAI-compatible tool-call fixture",
      method: "tarball install + real Agent tool call + safe GET retry + result transcript",
    },
    results,
  );
}
