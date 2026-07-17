import * as http from "node:http";

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

export async function startOpenAiModelFixture(port) {
  const metrics = {
    models: 0,
    completions: 0,
    embeddings: 0,
    lastRequest: null,
    lastEmbeddingRequest: null,
    toolCalls: 0,
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method === "GET" && url.pathname === "/v1/models") {
      metrics.models += 1;
      return writeJson(response, 200, {
        object: "list",
        data: [{ id: "fixture-model", object: "model", owned_by: "openclaw-e2e" }],
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      const body = await readJson(request);
      metrics.completions += 1;
      metrics.lastRequest = body;
      const created = Math.floor(Date.now() / 1000);
      const id = `chatcmpl-openclaw-e2e-${metrics.completions}`;
      const fixtureToolNames = new Set([
        "amap_search_places",
        "meituan_openapi_invoke",
        "rednode_ark_invoke",
      ]);
      const selectedTool = Array.isArray(body.tools)
        ? body.tools.find((tool) => fixtureToolNames.has(tool?.function?.name))
        : undefined;
      const toolCall = selectedTool?.function?.name === "rednode_ark_invoke"
        ? {
            id: "call_rednode_e2e",
            name: "rednode_ark_invoke",
            arguments: '{"operation":"item_list","query":{"status":"0","page_no":"1"}}',
          }
        : selectedTool?.function?.name === "meituan_openapi_invoke"
        ? {
            id: "call_meituan_e2e",
            name: "meituan_openapi_invoke",
            arguments: '{"operation":"shop_query","biz":{"shopId":"E2E-SHOP"}}',
          }
        : selectedTool
          ? {
              id: "call_amap_e2e",
              name: "amap_search_places",
              arguments: '{"keywords":"咖啡"}',
            }
          : null;
      // OpenClaw 会按 provider compat 归一化 Tool Result 的 role/字段，夹具不应依赖
      // 某一种上游序列化形态。Tool 插件均为隔离 E2E，一轮只发出一次确定性 tool_call；
      // 后续 completion 必须给最终文本，从而也能暴露宿主是否真的执行并回到模型。
      const requestFixtureTool = Boolean(toolCall && metrics.toolCalls === 0);
      if (requestFixtureTool) metrics.toolCalls += 1;
      if (body.stream !== true) {
        if (requestFixtureTool && toolCall) {
          return writeJson(response, 200, {
            id,
            object: "chat.completion",
            created,
            model: "fixture-model",
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: toolCall.id,
                  type: "function",
                  function: { name: toolCall.name, arguments: toolCall.arguments },
                }],
              },
              finish_reason: "tool_calls",
            }],
            usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
          });
        }
        return writeJson(response, 200, {
          id,
          object: "chat.completion",
          created,
          model: "fixture-model",
          choices: [{
            index: 0,
            message: { role: "assistant", content: "openclaw e2e fixture reply" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        });
      }
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      const chunks = [
        ...(requestFixtureTool && toolCall
          ? [
              {
                id,
                object: "chat.completion.chunk",
                created,
                model: "fixture-model",
                choices: [{
                  index: 0,
                  delta: {
                    role: "assistant",
                    tool_calls: [{
                      index: 0,
                      id: toolCall.id,
                      type: "function",
                      function: { name: toolCall.name, arguments: toolCall.arguments },
                    }],
                  },
                  finish_reason: null,
                }],
              },
              {
                id,
                object: "chat.completion.chunk",
                created,
                model: "fixture-model",
                choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
                usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
              },
            ]
          : [
              {
                id,
                object: "chat.completion.chunk",
                created,
                model: "fixture-model",
                choices: [{ index: 0, delta: { role: "assistant", content: "openclaw e2e fixture reply" }, finish_reason: null }],
              },
              {
                id,
                object: "chat.completion.chunk",
                created,
                model: "fixture-model",
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
              },
            ]),
      ];
      for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end("data: [DONE]\n\n");
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/embeddings") {
      const body = await readJson(request);
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      const dimensions = Number.isInteger(body.dimensions) && body.dimensions > 0
        ? body.dimensions
        : 1536;
      if (inputs.some((input) => typeof input !== "string")) {
        return writeJson(response, 400, { error: { message: "input must contain strings" } });
      }

      metrics.embeddings += 1;
      metrics.lastEmbeddingRequest = body;

      // Knowledge E2E 只验证 OpenAI-compatible 协议、维度约束与持久化链路。
      // 单位向量让相似度结果完全确定，避免把测试稳定性绑定到外部模型或浮点哈希。
      const embedding = Array.from({ length: dimensions }, (_, index) => index === 0 ? 1 : 0);
      return writeJson(response, 200, {
        object: "list",
        data: inputs.map((_, index) => ({
          object: "embedding",
          index,
          embedding,
        })),
        model: typeof body.model === "string" ? body.model : "fixture-embedding",
        usage: { prompt_tokens: inputs.length, total_tokens: inputs.length },
      });
    }
    return writeJson(response, 404, { error: "not_found" });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    metrics,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    }),
  };
}
