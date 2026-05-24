import { describe, expect, it } from "vitest";
import {
  resolveServerAddr,
  resolveProfile,
  expandDataIdTemplate,
  buildNacosConfigClientOptions,
} from "./nacos-connection.js";
import type { NacosPluginConfig } from "../shared/types.js";

describe("resolveServerAddr", () => {
  it("returns the first address from comma-separated list", () => {
    expect(resolveServerAddr("10.0.0.1:8848,10.0.0.2:8848")).toBe("10.0.0.1:8848");
  });

  it("returns the single address unchanged", () => {
    expect(resolveServerAddr("127.0.0.1:8848")).toBe("127.0.0.1:8848");
  });
});

describe("resolveProfile", () => {
  it("uses plugin profile when set", () => {
    expect(resolveProfile("dev", {})).toBe("dev");
  });

  it("falls back to OPENCLAW_PROFILE env", () => {
    expect(resolveProfile(undefined, { OPENCLAW_PROFILE: "staging" })).toBe("staging");
  });

  it("falls back to SPRING_PROFILES_ACTIVE env", () => {
    expect(resolveProfile(undefined, { SPRING_PROFILES_ACTIVE: "prod" })).toBe("prod");
  });

  it("defaults to 'default' when nothing set", () => {
    expect(resolveProfile(undefined, {})).toBe("default");
  });

  it("plugin profile overrides env variables", () => {
    expect(resolveProfile("custom", { OPENCLAW_PROFILE: "env" })).toBe("custom");
  });
});

describe("expandDataIdTemplate", () => {
  it("replaces ${profile} placeholder", () => {
    expect(expandDataIdTemplate("application-${profile}.json", "dev")).toBe("application-dev.json");
  });

  it("replaces ${spring.profiles.active} placeholder", () => {
    expect(expandDataIdTemplate("app-${spring.profiles.active}.yml", "prod")).toBe("app-prod.yml");
  });

  it("handles string without placeholders", () => {
    expect(expandDataIdTemplate("static.json", "dev")).toBe("static.json");
  });
});

describe("buildNacosConfigClientOptions", () => {
  it("builds options with serverAddr and namespace", () => {
    const cfg: NacosPluginConfig = {
      serverList: "127.0.0.1:8848",
      namespace: "custom-ns",
    };
    const opts = buildNacosConfigClientOptions(cfg) as Record<string, unknown>;
    expect(opts.serverAddr).toBe("127.0.0.1:8848");
    expect(opts.namespace).toBe("custom-ns");
    expect(opts.ssl).toBe(false);
  });

  it("prefers configCenter namespace over top-level", () => {
    const cfg: NacosPluginConfig = {
      serverList: "127.0.0.1:8848",
      namespace: "top-ns",
      configCenter: { enabled: true, namespace: "cc-ns" },
    };
    const opts = buildNacosConfigClientOptions(cfg) as Record<string, unknown>;
    expect(opts.namespace).toBe("cc-ns");
  });

  it("defaults namespace to 'public'", () => {
    const cfg: NacosPluginConfig = { serverList: "127.0.0.1:8848" };
    const opts = buildNacosConfigClientOptions(cfg) as Record<string, unknown>;
    expect(opts.namespace).toBe("public");
  });

  it("omits username/password when not set", () => {
    const cfg: NacosPluginConfig = { serverList: "127.0.0.1:8848" };
    const opts = buildNacosConfigClientOptions(cfg);
    expect(opts).not.toHaveProperty("username");
    expect(opts).not.toHaveProperty("password");
  });

  it("includes username/password when set", () => {
    const cfg: NacosPluginConfig = {
      serverList: "127.0.0.1:8848",
      username: "nacos",
      password: "secret",
    };
    const opts = buildNacosConfigClientOptions(cfg) as Record<string, unknown>;
    expect(opts.username).toBe("nacos");
    expect(opts.password).toBe("secret");
  });

  it("uses configCenter credentials over top-level", () => {
    const cfg: NacosPluginConfig = {
      serverList: "127.0.0.1:8848",
      username: "top",
      password: "top-pass",
      configCenter: { enabled: true, username: "cc-user", password: "cc-pass" },
    };
    const opts = buildNacosConfigClientOptions(cfg) as Record<string, unknown>;
    expect(opts.username).toBe("cc-user");
    expect(opts.password).toBe("cc-pass");
  });

  it("uses configServerList when set", () => {
    const cfg: NacosPluginConfig = {
      serverList: "10.0.0.1:8848",
      configServerList: "10.0.0.2:8848",
    };
    const opts = buildNacosConfigClientOptions(cfg) as Record<string, unknown>;
    expect(opts.serverAddr).toBe("10.0.0.2:8848");
  });
});
