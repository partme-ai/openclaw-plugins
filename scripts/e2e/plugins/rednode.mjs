/** RedNode capability 的正式 tarball → Agent Tool → Ark 签名闭环。 */
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
      "--session-key", "agent:main:rednode-e2e",
      "--message", "REDNODE_E2E_TOOL_CALL：查询测试商品",
      "--timeout", "60",
      "--json",
    ],
    { env: { ...process.env, NO_COLOR: "1" }, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
  );
  return `${stdout}\n${stderr}`;
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
export async function testRednode(ctx, results) {
  await runAdapterTest(
    ctx,
    "rednode",
    async () => {
      const model = ctx.modelFixture;
      const provider = ctx.rednodeProvider;
      if (!model || !provider) throw new Error("RedNode E2E requires model and Ark fixtures");

      const completionsBefore = model.metrics.completions;
      const output = await runAgent();
      if (!output.includes("openclaw e2e fixture reply")) {
        throw new Error("RedNode Agent Turn did not finish after tool execution");
      }
      if (model.metrics.completions !== completionsBefore + 2 || model.metrics.toolCalls !== 1) {
        throw new Error("RedNode Agent Turn did not perform exactly one tool-call round trip");
      }
      const metrics = provider.metrics;
      if (metrics.requests !== 2 || metrics.allSignaturesValid !== true) {
        throw new Error(`RedNode GET retry/signature mismatch: ${metrics.requests} requests`);
      }
      const request = metrics.lastRequest;
      if (
        request?.pathname !== "/ark/open_api/v1/items" ||
        request?.signatureValid !== true ||
        request?.appKeyHeader !== "rednode-e2e-app-key" ||
        request?.query?.status !== "0" ||
        request?.query?.page_no !== "1"
      ) {
        throw new Error("RedNode Ark signed query, headers, or allowlisted path mismatch");
      }
      if (!JSON.stringify(model.metrics.lastRequest).includes("OpenClaw E2E 商品")) {
        throw new Error("RedNode Tool Result did not return to the model transcript");
      }
    },
    {
      service: "local RedNode Ark signature fixture + OpenAI-compatible tool-call fixture",
      method: "tarball install + real Agent tool call + independent MD5 signature + safe GET retry + result transcript",
    },
    results,
  );
}
