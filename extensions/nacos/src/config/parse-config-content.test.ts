import { describe, expect, it } from "vitest";
import { parseConfigBody } from "./parse-config-content.js";

describe("parseConfigBody", () => {
  it("parses JSON and YAML config bodies", () => {
    expect(parseConfigBody('{"gateway":{"port":18789}}', "openclaw.json")).toEqual({
      gateway: { port: 18789 },
    });
    expect(parseConfigBody("gateway:\n  port: 18789", "openclaw.yaml")).toEqual({
      gateway: { port: 18789 },
    });
  });

  it("rejects duplicate YAML keys instead of silently selecting one", () => {
    expect(() => parseConfigBody("gateway: 1\ngateway: 2", "openclaw.yaml")).toThrow();
  });

  it("rejects prototype-pollution keys in JSON and YAML", () => {
    expect(() => parseConfigBody('{"__proto__":{"polluted":true}}', "openclaw.json")).toThrow(
      "unsafe key: __proto__",
    );
    expect(() => parseConfigBody("safe:\n  constructor:\n    polluted: true", "openclaw.yaml"))
      .toThrow("unsafe key: constructor");
  });

  it("rejects oversized config before parsing", () => {
    const oversized = `value: ${"x".repeat(2 * 1024 * 1024)}`;
    expect(() => parseConfigBody(oversized, "openclaw.yaml")).toThrow("exceeds 2097152 bytes");
  });

  it("rejects config trees deeper than the runtime safety limit", () => {
    const nested = `${"[".repeat(66)}0${"]".repeat(66)}`;
    expect(() => parseConfigBody(nested, "openclaw.json")).toThrow("maximum depth 64");
  });
});
