import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";

import { startOpenAiModelFixture } from "./openai-model-fixture.mjs";

async function freePort() {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

test("explicit one-shot OpenMem tool call returns a tool_call and then a final answer", async () => {
  const port = await freePort();
  const fixture = await startOpenAiModelFixture(port);
  const complete = async (messages, tools) => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "fixture-model", stream: false, messages, tools }),
    });
    return response.json();
  };
  try {
    fixture.controls.nextToolCall = { id: "callopenmeme2e", name: "openmem_search", arguments: '{"query":"海盐蓝"}' };
    const tools = [{ type: "function", function: { name: "openmem_search" } }];
    const first = await complete([{ role: "user", content: "查找海盐蓝" }], tools);
    assert.equal(first.choices[0].message.tool_calls?.[0]?.function?.name, "openmem_search");
    assert.equal(first.choices[0].message.tool_calls?.[0]?.id, "callopenmeme2e");
    assert.equal(fixture.controls.nextToolCall, null);
    const second = await complete([{ role: "tool", tool_call_id: "callopenmeme2e", content: "海盐蓝" }], tools);
    assert.equal(second.choices[0].message.content, "openclaw e2e fixture reply");
    assert.equal(second.choices[0].message.tool_calls, undefined);
  } finally {
    await fixture.close();
  }
});
