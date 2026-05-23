/**
 * STOMP 测试端脚本：
 * 1. 连接 STOMP TCP 服务；
 * 2. 订阅多个 topic；
 * 3. 发送多条消息；
 * 4. 校验是否收到回复。
 */

import net from "node:net";

type PublishCase = { destination: string; body: string };

function loadConfig(): {
  host: string;
  port: number;
  timeoutMs: number;
  subscribeTopics: string[];
  publishCases: PublishCase[];
} {
  const host = process.env.STOMP_HOST ?? "127.0.0.1";
  const port = Number(process.env.STOMP_PORT ?? "61613");
  const timeoutMs = Number(process.env.STOMP_TIMEOUT_MS ?? "20000");
  const subscribeTopics = (process.env.STOMP_TEST_SUBSCRIBE_TOPICS ?? "/topic/session.test,/topic/devices/reply")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  let publishCases: PublishCase[] = [
    {
      destination: process.env.STOMP_TEST_DEST_1 ?? "/topic/devices/a/in",
      body: process.env.STOMP_TEST_BODY_1 ?? "hello from topic A",
    },
    {
      destination: process.env.STOMP_TEST_DEST_2 ?? "/topic/devices/b/in",
      body: process.env.STOMP_TEST_BODY_2 ?? "hello from topic B",
    },
  ];

  if (process.env.STOMP_TEST_PUBLISH_CASES) {
    try {
      const parsed = JSON.parse(process.env.STOMP_TEST_PUBLISH_CASES) as PublishCase[];
      if (Array.isArray(parsed) && parsed.length > 0) publishCases = parsed;
    } catch {
      console.warn("[test-client] STOMP_TEST_PUBLISH_CASES is invalid JSON, use defaults");
    }
  }

  return { host, port, timeoutMs, subscribeTopics, publishCases };
}

function frame(command: string, headers: Record<string, string> = {}, body = ""): string {
  let output = `${command}\n`;
  for (const [key, value] of Object.entries(headers)) {
    output += `${key}:${value}\n`;
  }
  output += `\n${body}\0`;
  return output;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const socket = net.createConnection({ host: cfg.host, port: cfg.port });
  const received: string[] = [];

  socket.on("data", (chunk) => {
    const raw = chunk.toString("utf-8");
    received.push(raw);
    const ackMatch = raw.match(/\nack:([^\n]+)/);
    if (ackMatch?.[1]) {
      socket.write(frame("ACK", { id: ackMatch[1] }));
    }
    console.log(`[test-client] recv: ${raw.replace(/\0/g, "\\0")}`);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  socket.write(frame("CONNECT", { "accept-version": "1.2", host: "localhost" }));
  await waitFor(() => received.some((entry) => entry.includes("CONNECTED")), cfg.timeoutMs, "CONNECTED");

  for (let i = 0; i < cfg.subscribeTopics.length; i += 1) {
    const destination = cfg.subscribeTopics[i];
    socket.write(
      frame("SUBSCRIBE", {
        id: `sub-${i + 1}`,
        destination,
        ack: "client-individual",
        "prefetch-count": "10",
      }),
    );
  }

  for (const testCase of cfg.publishCases) {
    socket.write(
      frame("SEND", { destination: testCase.destination, "content-type": "text/plain" }, testCase.body),
    );
  }

  await waitFor(
    () => received.some((entry) => entry.includes("MESSAGE")),
    cfg.timeoutMs,
    "MESSAGE reply",
  );

  socket.end();
  console.log(`[test-client] success, received frames=${received.length}`);
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`[test-client] timeout waiting for ${label} in ${timeoutMs}ms`);
}

main().catch((error) => {
  console.error("[test-client] failed:", error);
  process.exitCode = 1;
});
