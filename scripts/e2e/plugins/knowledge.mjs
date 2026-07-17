/**
 * Knowledge 插件的跨进程安装态 E2E。
 *
 * 测试先从安装后的 tarball 导入公开 API，完成真实文档切分、Embedding HTTP 调用和
 * SQLite 落盘；随后通过 Gateway Agent Turn 验证 `before_prompt_build` 自动注入；
 * 最后重启 Gateway 并换 session 再查询，排除进程内 Store 缓存造成的假阳性。
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  KNOWLEDGE_E2E_CONFIG,
  KNOWLEDGE_E2E_DB_PATH,
} from "../config/plugins/knowledge.mjs";
import { ensureGatewayRunning } from "../lib/gateway.mjs";
import { OPENCLAW_BIN, PROFILE, REPO_ROOT, STATE_DIR } from "../lib/utils.mjs";
import { runAdapterTest } from "./_context.mjs";

const execFileAsync = promisify(execFile);
const KNOWLEDGE_SESSION_KEY = "agent:main:knowledge-e2e";
const KNOWLEDGE_SOURCE_ID = "knowledge-e2e-deployment-rule";
const KNOWLEDGE_FACT = "星云紫部署规范：所有生产发布必须先完成金丝雀验证，并保留可回滚版本。";
const KNOWLEDGE_QUERY = "知识库里的星云紫部署规范是什么？";

/** 通过真实 OpenClaw CLI 发起 Agent Turn，模型流量仍由本地 fixture 接收。 */
async function runAgent(sessionKey, message) {
  const { stdout, stderr } = await execFileAsync(
    OPENCLAW_BIN,
    [
      "--profile", PROFILE,
      "agent",
      "--agent", "main",
      "--session-key", sessionKey,
      "--message", message,
      "--timeout", "60",
      "--json",
    ],
    {
      env: { ...process.env, NO_COLOR: "1" },
      timeout: 90_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return `${stdout}\n${stderr}`;
}

/** 断言当前模型请求中确实包含 Knowledge Hook 生成的系统上下文。 */
function assertKnowledgeInjection(model, phase) {
  const request = JSON.stringify(model.metrics.lastRequest);
  if (!request.includes("[E2E KNOWLEDGE]") || !request.includes(KNOWLEDGE_FACT)) {
    throw new Error(`${phase} Agent Turn did not receive the indexed knowledge context`);
  }
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
export async function testKnowledge(ctx, results) {
  await runAdapterTest(
    ctx,
    "knowledge",
    async () => {
      const model = ctx.modelFixture;
      if (!model) throw new Error("Knowledge E2E requires the local OpenAI model fixture");

      const installedRoot = ctx.installedPath("knowledge");
      const peerLink = join(installedRoot, "node_modules", "openclaw");
      if (!existsSync(peerLink)) {
        // Gateway 插件加载器会从宿主提供 peer dependency；普通 Node 动态 import 没有
        // 该解析器，所以在测试安装目录挂载同一 OpenClaw 2026.7.1 宿主依赖。
        // 这只补测试执行上下文，不改变 tarball 内容或生产依赖声明。
        mkdirSync(dirname(peerLink), { recursive: true });
        symlinkSync(join(REPO_ROOT, "node_modules", "openclaw"), peerLink, "dir");
      }
      const installedEntry = join(installedRoot, "dist", "index.js");
      const knowledge = await import(pathToFileURL(installedEntry).href);
      if (typeof knowledge.indexFile !== "function" || typeof knowledge.searchByQuery !== "function" ||
          typeof knowledge.resolveConversationNamespace !== "function") {
        throw new Error("installed tarball does not expose the Knowledge library API");
      }
      // 公开 API 与 Gateway Hook 必须使用同一官方 sessionKey 解析器；这里不再手写
      // default:agent，以免安装态 E2E 再次掩盖 Hook/Tool namespace 漂移。
      const knowledgeNamespace = knowledge.resolveConversationNamespace({
        sessionKey: KNOWLEDGE_SESSION_KEY,
        agentId: "main",
      });

      mkdirSync(dirname(KNOWLEDGE_E2E_DB_PATH), { recursive: true });
      const documentPath = join(STATE_DIR, "knowledge-e2e", "deployment-rule.txt");
      writeFileSync(documentPath, `${KNOWLEDGE_FACT}\n`, { encoding: "utf8", mode: 0o600 });

      const embeddingsBeforeIndex = model.metrics.embeddings;
      try {
        const indexed = await knowledge.indexFile(documentPath, {
          config: KNOWLEDGE_E2E_CONFIG,
          namespace: knowledgeNamespace,
          sourceId: KNOWLEDGE_SOURCE_ID,
        });
        if (!indexed.success || indexed.chunksAdded < 1) {
          throw new Error(`installed Knowledge API failed to index document: ${indexed.error ?? "no chunks"}`);
        }

        const direct = await knowledge.searchByQuery(KNOWLEDGE_QUERY, {
          config: KNOWLEDGE_E2E_CONFIG,
          namespace: knowledgeNamespace,
          topK: 5,
          minScore: 0,
        });
        if (!direct.contextText.includes(KNOWLEDGE_FACT)) {
          throw new Error("installed Knowledge API could not retrieve the indexed fact");
        }
      } finally {
        // 关闭 E2E runner 进程里的 Store，确保后续 Gateway 必须从 SQLite 重新打开。
        await knowledge.invalidateStoreCache?.();
      }

      if (model.metrics.embeddings < embeddingsBeforeIndex + 2) {
        throw new Error("index and direct query did not both call the embedding endpoint");
      }
      const embeddingRequest = model.metrics.lastEmbeddingRequest;
      if (embeddingRequest?.model !== "fixture-embedding" || embeddingRequest?.dimensions !== 8) {
        throw new Error("Knowledge did not forward configured OpenAI embedding parameters");
      }

      const completionsBeforeFirst = model.metrics.completions;
      const first = await runAgent(KNOWLEDGE_SESSION_KEY, KNOWLEDGE_QUERY);
      if (!first.includes("openclaw e2e fixture reply") || model.metrics.completions !== completionsBeforeFirst + 1) {
        throw new Error("first Knowledge Agent Turn did not complete exactly once");
      }
      assertKnowledgeInjection(model, "first");

      // 真正重启 Gateway 后用同一稳定 sessionKey 再查询，证明 namespace 解析一致且知识
      // 来自持久层而非 runner/Gateway 的进程内 Store 缓存。
      await ensureGatewayRunning();
      const completionsBeforeSecond = model.metrics.completions;
      const second = await runAgent(KNOWLEDGE_SESSION_KEY, KNOWLEDGE_QUERY);
      if (!second.includes("openclaw e2e fixture reply") || model.metrics.completions !== completionsBeforeSecond + 1) {
        throw new Error("post-restart Knowledge Agent Turn did not complete exactly once");
      }
      assertKnowledgeInjection(model, "post-restart");
    },
    {
      service: "OpenAI-compatible embedding fixture + local SQLite knowledge store",
      method: "tarball API indexing/search + real Agent Turn injection + Gateway restart + stable-session recovery",
    },
    results,
  );
}
