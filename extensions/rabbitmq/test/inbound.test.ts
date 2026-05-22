/**
 * Wire MQ 插件 inbound SDK 集成门禁（三 mode 经 dispatchChannelMessage）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pluginRoot = dirname(fileURLToPath(import.meta.url));

describe("rabbitmq inbound", () => {
  it("uses dispatchChannelMessage and forbids direct agent APIs", () => {
    const source = readFileSync(join(pluginRoot, "../src/inbound.ts"), "utf-8");
    expect(source).toContain("dispatchChannelMessage");
    expect(source).toContain("resolveChannelDispatchIdentity");
    expect(source).not.toMatch(/runEmbeddedAgent/);
    expect(source).not.toMatch(/subagent\.run/);
    expect(source).not.toMatch(/dispatchViaEmbeddedAgent/);
    expect(source).not.toMatch(/dispatchViaSubagent/);
    expect(source).not.toMatch(/getOrCreateSessionKey/);
  });
});
