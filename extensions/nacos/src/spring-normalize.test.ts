import { describe, expect, it } from "vitest";
import {
  flattenSpringNacosPluginConfig,
  resolveConfigServerList,
  resolveNamingServerList,
} from "./spring-normalize.js";
import type { NacosPluginConfig } from "./types.js";

describe("flattenSpringNacosPluginConfig", () => {
  it("returns a copy when no nacos key", () => {
    const raw = { serverList: "a:8848", enabled: true };
    const out = flattenSpringNacosPluginConfig(raw);
    expect(out).toEqual(raw);
    expect(out).not.toBe(raw);
  });

  it("maps nacos.server-addr and discovery namespace", () => {
    const out = flattenSpringNacosPluginConfig({
      nacos: {
        "server-addr": "192.168.1.1:8848",
        username: "nacos",
        password: "sec",
        discovery: {
          namespace: "ns-1",
        },
      },
    });
    expect(out.serverList).toBe("192.168.1.1:8848");
    expect(out.namespace).toBe("ns-1");
    expect(out.username).toBe("nacos");
    expect(out.password).toBe("sec");
    expect(out.nacos).toBeUndefined();
  });

  it("uses discovery server-addr as serverList fallback when root missing", () => {
    const out = flattenSpringNacosPluginConfig({
      nacos: {
        discovery: {
          "server-addr": "10.0.0.2:8848",
          namespace: "pub",
        },
      },
    });
    expect(out.serverList).toBe("10.0.0.2:8848");
    expect(out.namingServerList).toBe("10.0.0.2:8848");
  });

  it("maps nacos.config shared-configs and data-id into configCenter", () => {
    const out = flattenSpringNacosPluginConfig({
      nacos: {
        "server-addr": "127.0.0.1:8848",
        config: {
          namespace: "cfg-ns",
          enabled: true,
          "shared-configs": [{ "data-id": "application-dev.yml", group: "DEFAULT_GROUP", refresh: true }],
        },
      },
    });
    expect(out.configServerList).toBeUndefined();
    const cc = out.configCenter as Record<string, unknown> | undefined;
    expect(cc?.enabled).toBe(true);
    expect(cc?.namespace).toBe("cfg-ns");
    const sc = cc?.sharedConfigs as Array<{ dataId: string }>;
    expect(sc?.[0]?.dataId).toBe("application-dev.yml");
  });

  it("does not override top-level serverList with nested nacos", () => {
    const out = flattenSpringNacosPluginConfig({
      serverList: "keep:8848",
      nacos: {
        "server-addr": "other:8848",
      },
    });
    expect(out.serverList).toBe("keep:8848");
  });

  it("merges flat configCenter over spring nacos.config", () => {
    const out = flattenSpringNacosPluginConfig({
      nacos: {
        "server-addr": "127.0.0.1:8848",
        config: {
          enabled: true,
          profile: "dev",
        },
      },
      configCenter: {
        enabled: false,
      },
    });
    const cc = out.configCenter as { enabled?: boolean; profile?: string };
    expect(cc.enabled).toBe(false);
    expect(cc.profile).toBe("dev");
  });
});

describe("resolveNamingServerList / resolveConfigServerList", () => {
  it("falls back to serverList", () => {
    const cfg = { serverList: "a:8848" } as NacosPluginConfig;
    expect(resolveNamingServerList(cfg)).toBe("a:8848");
    expect(resolveConfigServerList(cfg)).toBe("a:8848");
  });

  it("uses split lists when set", () => {
    const cfg = {
      serverList: "a:8848",
      namingServerList: "b:8848",
      configServerList: "c:8848",
    } as NacosPluginConfig;
    expect(resolveNamingServerList(cfg)).toBe("b:8848");
    expect(resolveConfigServerList(cfg)).toBe("c:8848");
  });
});
