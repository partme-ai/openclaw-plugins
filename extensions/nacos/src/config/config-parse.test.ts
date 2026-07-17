import { describe, expect, it } from "vitest";
import { parseNacosPluginConfig } from "./config-parse.js";

describe("parseNacosPluginConfig", () => {
  it("returns disabled when enabled is false", () => {
    const r = parseNacosPluginConfig({ enabled: false, serverList: "x" });
    expect(r.kind).toBe("disabled");
  });

  it("returns skip when serverList missing", () => {
    const r = parseNacosPluginConfig({ enabled: true });
    expect(r.kind).toBe("skip");
  });

  it("returns ok with merged fields", () => {
    const r = parseNacosPluginConfig({
      serverList: "127.0.0.1:8848",
      namespace: "public",
      serviceName: "gw",
      metadata: { env: "prod" },
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.config.serverList).toBe("127.0.0.1:8848");
      expect(r.config.namespace).toBe("public");
      expect(r.config.serviceName).toBe("gw");
      expect(r.config.metadata?.env).toBe("prod");
    }
  });

  it("returns skip when config absent", () => {
    const r = parseNacosPluginConfig(undefined);
    expect(r.kind).toBe("skip");
  });

  it("parses configCenter.sharedConfigs and pluginConfigIds", () => {
    const r = parseNacosPluginConfig({
      serverList: "127.0.0.1:8848",
      configCenter: {
        enabled: true,
        sharedConfigs: [{ dataId: "base.json", group: "DEFAULT_GROUP" }],
        pluginConfigIds: ["openclaw-weixin"],
        profile: "dev",
      },
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.config.configCenter?.enabled).toBe(true);
      expect(r.config.configCenter?.sharedConfigs?.[0]?.dataId).toBe(
        "base.json",
      );
      expect(r.config.configCenter?.pluginConfigIds).toEqual([
        "openclaw-weixin",
      ]);
      expect(r.config.configCenter?.profile).toBe("dev");
    }
  });

  it("只接受安全范围内的备份保留数量", () => {
    const accepted = parseNacosPluginConfig({
      serverList: "127.0.0.1:8848",
      configCenter: { enabled: true, backupRetentionCount: 30 },
    });
    expect(accepted.kind).toBe("ok");
    if (accepted.kind === "ok") {
      expect(accepted.config.configCenter?.backupRetentionCount).toBe(30);
    }

    for (const invalid of [0, 1001, 1.5, "20"]) {
      const result = parseNacosPluginConfig({
        serverList: "127.0.0.1:8848",
        configCenter: { enabled: true, backupRetentionCount: invalid },
      });
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(
          result.config.configCenter?.backupRetentionCount,
        ).toBeUndefined();
      }
    }
  });

  it("parses top-level username and password", () => {
    const r = parseNacosPluginConfig({
      serverList: "127.0.0.1:8848",
      username: "nacos",
      password: "secret",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.config.username).toBe("nacos");
      expect(r.config.password).toBe("secret");
    }
  });

  it("parses naming.enabled false", () => {
    const r = parseNacosPluginConfig({
      serverList: "127.0.0.1:8848",
      naming: { enabled: false },
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.config.naming?.enabled).toBe(false);
    }
  });

  it("默认失败关闭，并保留显式 degrade 与 clusterDiscovery 开关", () => {
    const defaultPolicy = parseNacosPluginConfig({
      serverList: "127.0.0.1:8848",
    });
    expect(defaultPolicy.kind).toBe("ok");
    if (defaultPolicy.kind === "ok") {
      expect(defaultPolicy.config.startupFailurePolicy).toBe("fail");
    }

    const degraded = parseNacosPluginConfig({
      serverList: "127.0.0.1:8848",
      startupFailurePolicy: "degrade",
      clusterDiscovery: { enabled: false },
    });
    expect(degraded.kind).toBe("ok");
    if (degraded.kind === "ok") {
      expect(degraded.config.startupFailurePolicy).toBe("degrade");
      expect(degraded.config.clusterDiscovery?.enabled).toBe(false);
    }
  });

  it("parses Spring-style nacos block with server-addr and shared-configs", () => {
    const r = parseNacosPluginConfig({
      nacos: {
        "server-addr": "192.168.3.115:8848",
        username: "nacos",
        password: "x",
        discovery: { namespace: "8179e717-5a53-432f-8904-4424716596a0" },
        config: {
          enabled: true,
          "shared-configs": [
            {
              "data-id": "application-dev.yml",
              group: "DEFAULT_GROUP",
              refresh: true,
            },
          ],
        },
      },
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.config.serverList).toBe("192.168.3.115:8848");
      expect(r.config.namespace).toBe("8179e717-5a53-432f-8904-4424716596a0");
      expect(r.config.configCenter?.enabled).toBe(true);
      expect(r.config.configCenter?.sharedConfigs?.[0]?.dataId).toBe(
        "application-dev.yml",
      );
    }
  });

  it("parses namingServerList and configServerList when distinct", () => {
    const r = parseNacosPluginConfig({
      serverList: "10.0.0.1:8848",
      namingServerList: "10.0.0.2:8848",
      configServerList: "10.0.0.3:8848",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.config.namingServerList).toBe("10.0.0.2:8848");
      expect(r.config.configServerList).toBe("10.0.0.3:8848");
    }
  });
});
