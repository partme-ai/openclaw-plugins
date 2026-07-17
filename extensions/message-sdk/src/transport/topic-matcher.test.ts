import { describe, it, expect } from "vitest";
import { matchTopic, isTopicAllowed } from "./topic-matcher.js";

describe("matchTopic", () => {
  // ── 精确匹配 ──
  it("精确匹配相同 topic", () => {
    expect(matchTopic("a/b/c", "a/b/c")).toBe(true);
  });

  it("精确匹配不同时返回 false", () => {
    expect(matchTopic("a/b/c", "a/b/d")).toBe(false);
  });

  // ── 空字符串 ──
  it("空 topic 与空 pattern 匹配", () => {
    expect(matchTopic("", "")).toBe(true);
  });

  it("空 topic 与非空 pattern 不匹配", () => {
    expect(matchTopic("", "a")).toBe(false);
  });

  it("非空 topic 与空 pattern 不匹配", () => {
    expect(matchTopic("a", "")).toBe(false);
  });

  // ── MQTT `+` 单级通配符 ──
  it("+ 匹配单级", () => {
    expect(matchTopic("a/b/c", "a/+/c")).toBe(true);
  });

  it("+ 不匹配多级", () => {
    expect(matchTopic("a/b/c/d", "a/+/c")).toBe(false);
  });

  it("+ 匹配首级", () => {
    expect(matchTopic("x/b/c", "+/b/c")).toBe(true);
  });

  it("+ 匹配末级", () => {
    expect(matchTopic("a/b/c", "a/b/+")).toBe(true);
  });

  it("+ 不匹配缺失层级", () => {
    expect(matchTopic("a", "a/+")).toBe(false);
  });

  // ── STOMP `*` 单级通配符 ──
  it("* 匹配单级（STOMP 风格）", () => {
    expect(matchTopic("a/b/c", "a/*/c")).toBe(true);
  });

  it("* 不匹配缺失层级", () => {
    expect(matchTopic("a", "a/*")).toBe(false);
  });

  // ── `#` 多级通配符 ──
  it("# 匹配剩余所有层级", () => {
    expect(matchTopic("a/b/c/d", "a/#")).toBe(true);
  });

  it("# 匹配零个剩余层级", () => {
    expect(matchTopic("a", "a/#")).toBe(true);
  });

  it("# 在 pattern 末尾生效", () => {
    expect(matchTopic("a/b/c", "a/b/#")).toBe(true);
  });

  it("# 不在末尾时 fail-closed", () => {
    expect(matchTopic("a/b/c", "a/#/c")).toBe(false);
  });

  // ── 层级长度不匹配 ──
  it("topic 层级多于 pattern 时不匹配（无通配符）", () => {
    expect(matchTopic("a/b/c", "a/b")).toBe(false);
  });

  it("topic 层级少于 pattern 时不匹配（无通配符）", () => {
    expect(matchTopic("a", "a/b")).toBe(false);
  });

  // ── 带前导/尾部斜线 ──
  it("前导斜线产生空层级", () => {
    expect(matchTopic("/a/b", "/a/b")).toBe(true);
    expect(matchTopic("/a/b", "a/b")).toBe(false);
  });

  it("尾部斜线产生空层级", () => {
    expect(matchTopic("a/b/", "a/b/")).toBe(true);
    expect(matchTopic("a/b/", "a/b")).toBe(false);
  });

  // ── 综合场景 ──
  it("MQTT 典型场景: sensor/+/temperature", () => {
    expect(matchTopic("sensor/room1/temperature", "sensor/+/temperature")).toBe(true);
    expect(matchTopic("sensor/room2/temperature", "sensor/+/temperature")).toBe(true);
    expect(matchTopic("sensor/room1/humidity", "sensor/+/temperature")).toBe(false);
  });

  it("MQTT 典型场景: home/#", () => {
    expect(matchTopic("home/living/light", "home/#")).toBe(true);
    expect(matchTopic("home", "home/#")).toBe(true);
    expect(matchTopic("office/living/light", "home/#")).toBe(false);
  });
});

describe("MQTT topic 语法校验", () => {
  it("接受合法 Topic Name，拒绝空值、NUL、通配符和超长名称", async () => {
    const { isValidMqttTopicName } = await import("./topic-matcher.js");
    expect(isValidMqttTopicName("devices/room-1/out")).toBe(true);
    expect(isValidMqttTopicName("")).toBe(false);
    expect(isValidMqttTopicName("devices/+/out")).toBe(false);
    expect(isValidMqttTopicName("devices/#")).toBe(false);
    expect(isValidMqttTopicName("devices/\0/out")).toBe(false);
    expect(isValidMqttTopicName("x".repeat(65_536))).toBe(false);
  });

  it("只允许完整层级的 + 和位于末尾的 #", async () => {
    const { isValidMqttTopicFilter } = await import("./topic-matcher.js");
    expect(isValidMqttTopicFilter("devices/+/in")).toBe(true);
    expect(isValidMqttTopicFilter("devices/#")).toBe(true);
    expect(isValidMqttTopicFilter("devices/#/admin")).toBe(false);
    expect(isValidMqttTopicFilter("devices/sensor+/in")).toBe(false);
    expect(isValidMqttTopicFilter("devices/foo#")).toBe(false);
    expect(isValidMqttTopicFilter("devices/*/in")).toBe(false);
  });
});

describe("isTopicAllowed", () => {
  it("空 patterns 列表表示全放行", () => {
    expect(isTopicAllowed("any/topic", [])).toBe(true);
  });

  it("匹配白名单中的 pattern", () => {
    expect(isTopicAllowed("sensor/room1/temp", ["sensor/+/temp"])).toBe(true);
  });

  it("不匹配白名单时返回 false", () => {
    expect(isTopicAllowed("sensor/room1/humidity", ["sensor/+/temp"])).toBe(false);
  });

  it("多个 pattern 任一匹配即可", () => {
    const patterns = ["sensor/+/temp", "alarm/#"];
    expect(isTopicAllowed("sensor/room1/temp", patterns)).toBe(true);
    expect(isTopicAllowed("alarm/fire", patterns)).toBe(true);
    expect(isTopicAllowed("other/topic", patterns)).toBe(false);
  });
});
