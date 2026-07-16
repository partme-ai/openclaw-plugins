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
  const metrics = { models: 0, completions: 0, lastRequest: null };
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
      if (body.stream !== true) {
        return writeJson(response, 200, {
          id,
          object: "chat.completion",
          created,
          model: "fixture-model",
          choices: [{
            index: 0,
            message: { role: "assistant", content: "tracing e2e reply" },
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
        {
          id,
          object: "chat.completion.chunk",
          created,
          model: "fixture-model",
          choices: [{ index: 0, delta: { role: "assistant", content: "tracing e2e reply" }, finish_reason: null }],
        },
        {
          id,
          object: "chat.completion.chunk",
          created,
          model: "fixture-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        },
      ];
      for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end("data: [DONE]\n\n");
      return;
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
