/**
 * Wire MQ 插件 inbound.ts 门禁：禁止直接调用 embedded/subagent API 与本地 sessionKey 拼接。
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionsRoot = join(__dirname, "../../");

const WIRE_PLUGINS = [
  "mqtt",
  "rabbitmq",
  "rocketmq",
  "redis-stream",
  "stomp",
  "web-mqtt",
  "web-stomp",
] as const;

const FORBIDDEN_PATTERNS = [
  /runEmbeddedAgent/,
  /subagent\.run/,
  /dispatchViaEmbeddedAgent/,
  /dispatchViaSubagent/,
  /getOrCreateSessionKey/,
  /getOrCreateSessionContext/,
  /agent:\$\{[^}]+\}:main/,
  /`agent:\$\{/,
];

const REQUIRED_PATTERNS = [/createChannelDispatch/, /resolveChannelDispatchIdentity|resolveChannelAgentRoute/];

describe("wire plugin inbound guard", () => {
  for (const plugin of WIRE_PLUGINS) {
    it(`${plugin}/src/inbound.ts must use SDK dispatch + route resolve`, () => {
      const inboundPath = join(extensionsRoot, plugin, "src/inbound.ts");
      expect(existsSync(inboundPath), `missing ${inboundPath}`).toBe(true);
      const source = readFileSync(inboundPath, "utf-8");
      for (const pattern of REQUIRED_PATTERNS) {
        expect(source).toMatch(pattern);
      }
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(source).not.toMatch(pattern);
      }
    });
  }
});
