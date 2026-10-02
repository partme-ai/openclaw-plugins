/**
 * OpenMem 插件的真实安装态 E2E。
 *
 * 测试通过真实 Gateway Agent Turn 触发 session_start/agent_end，再调用正式 sessions.reset
 * 触发 session_end；随后检查真实 OpenMem Server 的事件、工作记忆、archive 和 continuity
 * 检索，并确认 Gateway 重启后下一轮模型请求仍带有上一会话上下文。
 * OpenMem 工具调用需单独验证；此处的模型上下文可能由 OpenClaw transcript 保留。
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { OPENCLAW_BIN, PROFILE } from "../lib/utils.mjs";
import { ensureGatewayRunning, stopHostGateway } from "../lib/gateway.mjs";
import { runAdapterTest } from "./_context.mjs";

const execFileAsync = promisify(execFile);
const SESSION_KEY = "agent:main:openmem-e2e";
const FIRST_MEMORY = "OpenMem 真实联调代号是海盐蓝，回答应保持简洁。";

/** A prior ACTIVE session may have the same fact; accept only this run's marker. */
export async function findRunSession(sessions, marker, readEvents) {
  for (const session of sessions ?? []) {
    if (session.agent_id !== "main" || !(session.event_count > 0)) continue;
    const events = await readEvents(session.session_id);
    if (events.events?.some((event) => event.content?.includes(marker))) return session;
  }
  return undefined;
}

/** A replay of an empty memory set cannot prove fact-memory idempotency. */
export function assertStableCommitReplay(first, second) {
  if (!first.archive?.archive_id || first.archive.archive_id !== second.archive?.archive_id) {
    throw new Error("repeated authenticated commit changed archive ID");
  }
  if (!Array.isArray(first.memories) || first.memories.length === 0 || !Array.isArray(second.memories)) {
    throw new Error("repeated authenticated commit lacks fact memory IDs");
  }
  const firstIds = first.memories.map((memory) => memory?.memory_id);
  const secondIds = second.memories.map((memory) => memory?.memory_id);
  if (firstIds.some((id) => typeof id !== "string" || !id.trim()) ||
      secondIds.some((id) => typeof id !== "string" || !id.trim()) ||
      JSON.stringify(firstIds) !== JSON.stringify(secondIds)) {
    throw new Error("repeated authenticated commit changed fact memory IDs");
  }
}

/** Require the model continuation to contain this tool's result, not transcript text. */
export function findToolResultMessage(messages, toolCallId, expectedText) {
  const result = Array.isArray(messages)
    ? messages.find((message) => message?.role === "tool" && message.tool_call_id === toolCallId)
    : undefined;
  const resultContent = JSON.stringify(result?.content) ?? "";
  const citation = /openmem\/(?:archive|memory)\/[^\s()"\\]+#L1/.test(resultContent);
  if (!result || !resultContent.includes(expectedText) || !citation) {
    const outline = Array.isArray(messages) ? messages.map((message) => {
      const content = JSON.stringify(message?.content) ?? "";
      return {
        role: message?.role,
        toolCallId: message?.tool_call_id,
        hasExpectedText: content.includes(expectedText),
        hasCitation: /openmem\/(?:archive|memory)\/[^\s()"\\]+#L1/.test(content),
        contentLength: content.length,
      };
    }) : [];
    throw new Error(`OpenMem tool result is absent from the model continuation: ${JSON.stringify(outline)}`);
  }
  return result;
}

async function runCli(args) {
  const { stdout, stderr } = await execFileAsync(
    OPENCLAW_BIN,
    ["--profile", PROFILE, ...args],
    { env: { ...process.env, NO_COLOR: "1" }, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
  );
  return `${stdout}\n${stderr}`;
}

async function readJson(baseUrl, path, init) {
  const protectedMode = process.env.OPENMEM_E2E_PROTECTED === "1";
  const token = process.env.OPENMEM_E2E_PROXY_TOKEN;
  if (protectedMode && !token) throw new Error("protected OpenMem E2E token is missing");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      ...(protectedMode ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`OpenMem ${path} returned ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : undefined;
}

async function runAgent(message) {
  return runCli([
    "agent", "--agent", "main", "--session-key", SESSION_KEY,
    "--message", message, "--timeout", "60", "--json",
  ]);
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testOpenMem(ctx, results) {
  await runAdapterTest(
    ctx,
    "openmem",
    async () => {
      const model = ctx.modelFixture;
      const sidecar = ctx.openmemSidecar;
      if (!model || !sidecar) throw new Error("OpenMem E2E requires model fixture and real OpenMem sidecar");
      const protectedMode = process.env.OPENMEM_E2E_PROTECTED === "1";
      const endpoint = protectedMode ? process.env.OPENMEM_E2E_PROXY_URL : sidecar.baseUrl;
      if (!endpoint) throw new Error("OpenMem E2E endpoint is missing");

      const health = await readJson(endpoint, "/healthz");
      if (health?.status !== "ok") throw new Error("real OpenMem health check failed");

      const runMarker = randomUUID();
      const beforeFirst = model.metrics.completions;
      const first = await runAgent(`${FIRST_MEMORY} 本轮唯一标识：${runMarker}`);
      if (!first.includes("openclaw e2e fixture reply") || model.metrics.completions !== beforeFirst + 1) {
        throw new Error("first Agent Turn did not complete exactly once through the model fixture");
      }
      if (protectedMode && !model.metrics.lastRequest?.tools?.some((tool) => tool?.function?.name === "openmem_search")) {
        throw new Error("installed Gateway did not expose openmem_search to the model");
      }

      let firstSession;
      await ctx.waitFor(async () => {
        const data = await readJson(endpoint, "/sessions?status=ACTIVE");
        firstSession = await findRunSession(data.sessions, runMarker, (sessionId) =>
          readJson(endpoint, `/events?sessionId=${encodeURIComponent(sessionId)}`));
        return Boolean(firstSession);
      }, { label: "OpenMem current-run ACTIVE session ingest", timeoutMs: 30_000 });

      const events = await readJson(endpoint, `/events?sessionId=${encodeURIComponent(firstSession.session_id)}`);
      if (!events.events?.some((event) => event.content?.includes("海盐蓝") && event.content.includes(runMarker))) {
        throw new Error("agent_end did not ingest the current user turn into real OpenMem");
      }
      const working = await readJson(endpoint, `/sessions/${encodeURIComponent(firstSession.session_id)}/working-memory`);
      if (!JSON.stringify(working).includes(runMarker)) {
        throw new Error("agent_end did not append the current turn to OpenMem working memory");
      }

      // 2026.7.1 在 Gateway shutdown drain 中等待每个已跟踪 session 的 session_end。
      // 这里使用正式关闭流程，既不绕过管理员 RPC scope，也能验证插件停止前完成 commit。
      stopHostGateway();

      let archived;
      await ctx.waitFor(async () => {
        const data = await readJson(endpoint, "/sessions?status=ARCHIVED");
        archived = data.sessions?.find((session) => session.session_id === firstSession.session_id);
        return Boolean(archived);
      }, { label: "OpenMem session_end commit/archive", timeoutMs: 30_000 });

      const recall = await readJson(endpoint, "/inspect/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "海盐蓝", mode: "continuity", sessionId: archived.session_id, limit: 10 }),
      });
      if (!recall.chunks?.some((chunk) => chunk.recall_type === "continuity" && chunk.text.includes("海盐蓝"))) {
        throw new Error("committed session was not available through real continuity recall");
      }

      if (protectedMode) {
        const commitPath = `/sessions/${encodeURIComponent(archived.session_id)}/commit`;
        const firstReplay = await readJson(endpoint, commitPath, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        const secondReplay = await readJson(endpoint, commitPath, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        assertStableCommitReplay(firstReplay, secondReplay);
      }

      const searchBeforeTool = protectedMode
        ? (await readJson(endpoint, "/__e2e_metrics")).successfulPaths?.["POST /inspect/search"] ?? 0
        : 0;
      await ensureGatewayRunning();
      const beforeSecond = model.metrics.completions;
      const beforeToolCalls = model.metrics.toolCalls;
      if (protectedMode) {
        model.controls.nextToolCall = {
          id: "callopenmeme2e",
          name: "openmem_search",
          arguments: JSON.stringify({ query: "海盐蓝", limit: 10 }),
        };
      }
      const second = await runAgent(protectedMode
        ? "请调用 openmem_search 工具检索上一段会话中的联调代号。"
        : "上一段会话中的联调代号是什么？");
      if (!second.includes("openclaw e2e fixture reply") ||
          model.metrics.completions !== beforeSecond + (protectedMode ? 2 : 1)) {
        throw new Error("second Agent Turn did not complete expected model calls");
      }
      if (!JSON.stringify(model.metrics.lastRequest).includes(runMarker)) {
        throw new Error("previous-session context was absent from the next Agent Turn");
      }
      if (protectedMode) {
        if (model.metrics.toolCalls !== beforeToolCalls + 1 || model.controls.nextToolCall !== null) {
          throw new Error("model fixture did not issue exactly one OpenMem tool call");
        }
        const searchAfterTool = (await readJson(endpoint, "/__e2e_metrics")).successfulPaths?.["POST /inspect/search"] ?? 0;
        if (searchAfterTool <= searchBeforeTool) {
          throw new Error("openmem_search did not make a new request through the authenticated HTTPS proxy");
        }
        try {
          findToolResultMessage(model.metrics.lastRequest?.messages, "callopenmeme2e", "海盐蓝");
        } catch (error) {
          throw new Error(`${error.message}; proxy search ${searchBeforeTool} → ${searchAfterTool}`);
        }
      }
    },
    {
      service: process.env.OPENMEM_E2E_PROTECTED === "1" ? "authenticated HTTPS proxy + production OpenMem Server" : "real workspace OpenMem Server",
      method: "tarball install + Agent Turn + shutdown drain + archive + Sidecar continuity API + Gateway restart context" +
        (process.env.OPENMEM_E2E_PROTECTED === "1" ? " + authenticated idempotent commit replay + model tool call and tool-role result" : ""),
    },
    results,
  );
}
