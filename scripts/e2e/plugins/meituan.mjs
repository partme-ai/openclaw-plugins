/** 美团 capability 的正式 tarball → Agent Tool → MTOp 签名闭环。 */
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
      "--session-key", "agent:main:meituan-e2e",
      "--message", "MEITUAN_E2E_TOOL_CALL：查询测试门店",
      "--timeout", "60",
      "--json",
    ],
    { env: { ...process.env, NO_COLOR: "1" }, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
  );
  return `${stdout}\n${stderr}`;
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
export async function testMeituan(ctx, results) {
  await runAdapterTest(
    ctx,
    "meituan",
    async () => {
      const model = ctx.modelFixture;
      const provider = ctx.meituanProvider;
      if (!model || !provider) throw new Error("Meituan E2E requires model and MTOp fixtures");

      const completionsBefore = model.metrics.completions;
      const output = await runAgent();
      if (!output.includes("openclaw e2e fixture reply")) {
        throw new Error("Meituan Agent Turn did not finish after tool execution");
      }
      if (model.metrics.completions !== completionsBefore + 2 || model.metrics.toolCalls !== 1) {
        throw new Error("Meituan Agent Turn did not perform exactly one tool-call round trip");
      }
      if (provider.metrics.requests !== 1) {
        throw new Error(`Meituan successful read should use one POST: ${provider.metrics.requests} requests`);
      }
      const request = provider.metrics.lastRequest;
      const fields = request?.fields ?? {};
      if (
        request?.pathname !== "/e2e/shop/query" ||
        request?.signatureValid !== true ||
        request?.developerHeader !== "123456" ||
        fields.businessId !== "7001" ||
        fields.developerId !== "123456" ||
        fields.appAuthToken !== "meituan-e2e-auth-token" ||
        fields.biz !== '{"shopId":"E2E-SHOP"}'
      ) {
        throw new Error("Meituan MTOp signed form or bounded operation path mismatch");
      }
      if (!JSON.stringify(model.metrics.lastRequest).includes("OpenClaw E2E 门店")) {
        throw new Error("Meituan Tool Result did not return to the model transcript");
      }
    },
    {
      service: "local Meituan MTOp signature fixture + OpenAI-compatible tool-call fixture",
      method: "tarball install + real Agent tool call + signed form + successful read + result transcript",
    },
    results,
  );
}
