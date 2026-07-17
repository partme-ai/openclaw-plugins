/**
 * Memory Host 的跨进程安装态 E2E。
 *
 * 第一轮通过真实 Gateway Agent Turn 触发受保护的 `agent_end`，随后检查 L0-L3 落盘；
 * 重启 Gateway 后用 CLI 读取同一 Memory Host，再在不同 session 发起第二轮，确认 L3
 * 画像确实进入模型请求。这样同时验证 slot 选择、Hook 信任、持久化和自动召回。
 */
import { execFile } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { promisify } from "node:util";

import { MEMORY_E2E_DATA_DIR } from "../config/plugins/memory.mjs";
import { ensureGatewayRunning } from "../lib/gateway.mjs";
import { OPENCLAW_BIN, PROFILE } from "../lib/utils.mjs";
import { runAdapterTest } from "./_context.mjs";

const execFileAsync = promisify(execFile);
const FIRST_MEMORY = "我喜欢简洁的中文回答，长期偏好代号是星云紫。";

function filesUnder(root) {
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else files.push(path);
    }
  };
  visit(root);
  return files;
}

function readJsonLines(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function runCli(args) {
  const { stdout, stderr } = await execFileAsync(
    OPENCLAW_BIN,
    ["--profile", PROFILE, ...args],
    {
      env: { ...process.env, NO_COLOR: "1" },
      timeout: 90_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return `${stdout}\n${stderr}`;
}

async function runAgent(sessionKey, message) {
  return runCli([
    "agent",
    "--agent", "main",
    "--session-key", sessionKey,
    "--message", message,
    "--timeout", "60",
    "--json",
  ]);
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testMemory(ctx, results) {
  await runAdapterTest(
    ctx,
    "memory",
    async () => {
      const model = ctx.modelFixture;
      if (!model) throw new Error("Memory E2E requires the local OpenAI model fixture");

      const beforeFirst = model.metrics.completions;
      const first = await runAgent("agent:main:memory-e2e-a", FIRST_MEMORY);
      if (!first.includes("openclaw e2e fixture reply")) {
        throw new Error(`first Agent Turn did not complete through the model fixture: ${first.slice(-500)}`);
      }
      if (model.metrics.completions !== beforeFirst + 1) {
        throw new Error("first Agent Turn did not make exactly one model request");
      }

      let jsonlFiles = [];
      await ctx.waitFor(async () => {
        try {
          jsonlFiles = filesUnder(MEMORY_E2E_DATA_DIR).filter((file) => file.endsWith(".jsonl"));
          return jsonlFiles.length >= 4;
        } catch {
          return false;
        }
      }, { label: "Memory L0-L3 persistence", timeoutMs: 30_000 });

      const records = jsonlFiles.flatMap(readJsonLines);
      const levels = new Set(records.map((record) => record.level));
      for (const level of ["L0", "L1", "L2", "L3"]) {
        if (!levels.has(level)) throw new Error(`completed turn did not persist ${level}`);
      }
      if (!records.some((record) => record.level === "L3" && record.content?.includes("星云紫"))) {
        throw new Error("explicit preference did not produce the expected L3 profile");
      }
      if (jsonlFiles.some((file) => file.includes("memory-e2e-a"))) {
        throw new Error("raw session key leaked into the physical storage path");
      }
      const unsafeMode = jsonlFiles.find((file) => (statSync(file).mode & 0o777) !== 0o600);
      if (unsafeMode) throw new Error(`memory file is not mode 0600: ${unsafeMode}`);

      // 强制重启后再查询，避免只证明进程内 Map 能搜到刚写入的数据。
      await ensureGatewayRunning();
      const search = await runCli([
        "memory", "search", "星云紫",
        "--agent", "main",
        "--max-results", "10",
        "--json",
      ]);
      if (!search.includes("星云紫") || !search.includes("L3/profile")) {
        throw new Error(`restarted Memory Host did not return the L3 profile: ${search.slice(-800)}`);
      }

      const beforeSecond = model.metrics.completions;
      const second = await runAgent(
        "agent:main:memory-e2e-b",
        "我的长期偏好代号星云紫对应什么回答要求？",
      );
      if (!second.includes("openclaw e2e fixture reply") || model.metrics.completions !== beforeSecond + 1) {
        throw new Error("second cross-session Agent Turn did not complete exactly once");
      }
      const modelRequest = JSON.stringify(model.metrics.lastRequest);
      if (!modelRequest.includes(FIRST_MEMORY) || !modelRequest.includes("L3/profile")) {
        throw new Error("cross-session L3 memory was not injected into the second model request");
      }
    },
    {
      service: "OpenClaw Memory Host + local JSONL store",
      method: "tarball install + real Agent Turn + L0-L3 persistence + Gateway restart + cross-session L3 recall",
    },
    results,
  );
}
