/**
 * @fileoverview Nacos Config Center 到 OpenClaw 运行配置的拉取、合并与订阅服务。
 *
 * 合并顺序为主配置 → shared configs → application config → 各插件 config，随后展开环境变量、
 * 校验可序列化性、备份当前 openclaw.json，再通过 Runtime `replaceConfig` 原子替换。订阅
 * 回调采用单飞调度，避免配置连续变更导致并发覆盖；停止时注销全部监听并关闭 SDK 客户端。
 *
 * @module nacos/runtime/nacos-config-sync
 */

import { copyFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NacosConfigClient } from "nacos";
import { deepMerge } from "../config/merge-deep.js";
import { formatTimestampYyyyMMddHHmmss } from "../shared/format-timestamp.js";
import {
  buildNacosConfigClientOptions,
  expandDataIdTemplate,
  resolveGroupName,
  resolveProfile,
} from "./nacos-connection.js";
import { expandEnvPlaceholdersInValue } from "../config/env-expand.js";
import { parseConfigBody } from "../config/parse-config-content.js";
import { createNacosSdkLogger, DEFAULT_GROUP, tryCloseNacosClient } from "../shared/shared.js";
import type { NacosPluginConfig, PluginLog } from "../shared/types.js";

export type ConfigSyncDeps = {
  pluginConfig: NacosPluginConfig;
  /** Returns current runtime config snapshot (via `api.runtime.config.current()`). */
  getCurrentConfig: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Replaces config file with the merged result and triggers a reload. */
  replaceConfig: (next: Record<string, unknown>) => Promise<void>;
  stateDir: string;
  logger: PluginLog;
  env: NodeJS.ProcessEnv;
  /** 每次配置成功写入后更新外部健康状态。 */
  onApplied?: () => void;
  /** 后台订阅拉取失败时更新外部健康状态。 */
  onError?: (error: unknown) => void;
};

/**
 * Resolves the on-disk config file path for backup (aligns with OpenClaw: `OPENCLAW_CONFIG_PATH` or `stateDir/openclaw.json`).
 */
export function resolveConfigFileForBackup(env: NodeJS.ProcessEnv, stateDir: string): string {
  const override = env.OPENCLAW_CONFIG_PATH?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
  }
  return path.join(stateDir, "openclaw.json");
}

/**
 * Backs up the active OpenClaw config file into `stateDir` before overwrite.
 */
export function backupOpenClawConfig(
  stateDir: string,
  env: NodeJS.ProcessEnv,
  logger: PluginLog,
): void {
  const src = resolveConfigFileForBackup(env, stateDir);
  if (!existsSync(src)) {
    logger.warn(`[openclaw-nacos] skip backup: ${src} not found`);
    return;
  }
  const stamp = formatTimestampYyyyMMddHHmmss();
  // 时间戳只有秒级；追加随机后缀，避免连续回调覆盖同一份回滚证据。
  const dest = path.join(stateDir, `openclaw-nacos-${stamp}-${randomUUID().slice(0, 8)}.json`);
  try {
    copyFileSync(src, dest);
    logger.info(`[openclaw-nacos] config backup written: ${dest}`);
  } catch (err) {
    logger.error(`[openclaw-nacos] backup failed: ${String(err)}`);
    throw err;
  }
}

function validateMergedConfig(
  cfg: Record<string, unknown>,
  skipValidation: boolean | undefined,
  logger: PluginLog,
): void {
  if (skipValidation) {
    logger.warn("[openclaw-nacos] skipValidation: skipping structural checks");
    return;
  }
  try {
    JSON.stringify(cfg);
  } catch (err) {
    throw new Error(`[openclaw-nacos] merged config is not JSON-serializable: ${String(err)}`);
  }
  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) {
    throw new Error("[openclaw-nacos] merged config must be a plain object");
  }
}

/** 拉取远程配置，按确定性顺序深度合并，备份当前文件后应用到 OpenClaw Runtime。 */
export class NacosConfigSyncService {
  private client: NacosConfigClient | null = null;
  private unsubscribeFns: Array<() => void> = [];
  private deps: ConfigSyncDeps | null = null;
  private runningPull: Promise<void> | null = null;
  /** 拉取期间再次收到变更时置位，当前轮完成后至少再执行一轮。 */
  private pullRequested = false;
  /** 每次 start/stop 递增；旧代拉取不得在新生命周期内写配置。 */
  private lifecycleGeneration = 0;
  private stopping = false;

  /**
   * Fetches remote config with an existing client and merges into `loadConfig()` snapshot.
   */
  async pullAndApply(
    deps: ConfigSyncDeps,
    clientOverride?: NacosConfigClient,
    expectedGeneration?: number,
  ): Promise<void> {
    const { pluginConfig, getCurrentConfig, replaceConfig, stateDir, logger, env } = deps;
    const cc = pluginConfig.configCenter;
    if (!cc?.enabled) {
      return;
    }

    const client = clientOverride ?? this.client;
    if (!client) {
      throw new Error("[openclaw-nacos] NacosConfigClient not initialized");
    }

    const profile = resolveProfile(cc.profile, env);
    const snapshot = await Promise.resolve(getCurrentConfig());
    let merged: Record<string, unknown>;

    // Load complete config from primary dataId (source of truth), then layer shared/plugin configs on top
    if (cc.primaryConfigDataId) {
      const dataId = expandDataIdTemplate(cc.primaryConfigDataId, profile);
      const group = resolveGroupName(cc.primaryConfigGroup);
      const raw = await client.getConfig(dataId, group);
      if (raw != null && String(raw).trim() !== "") {
        const parsed = parseConfigBody(String(raw), dataId);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          merged = { ...parsed as Record<string, unknown> };
          logger.info(`[openclaw-nacos] loaded primary config from ${dataId} (group=${group})`);
        } else {
          logger.warn(`[openclaw-nacos] primary config ${dataId} is not a valid object; falling back to snapshot`);
          merged = { ...snapshot } as Record<string, unknown>;
        }
      } else {
        logger.warn(`[openclaw-nacos] primary config ${dataId} is empty or not found; using snapshot`);
        merged = { ...snapshot } as Record<string, unknown>;
      }
    } else {
      merged = { ...snapshot } as Record<string, unknown>;
    }

    for (const sc of cc.sharedConfigs ?? []) {
      const group = resolveGroupName(sc.group);
      const raw = await client.getConfig(sc.dataId, group);
      if (raw == null || String(raw).trim() === "") {
        logger.warn(`[openclaw-nacos] empty config for dataId=${sc.dataId} group=${group}`);
        continue;
      }
      const parsed = parseConfigBody(String(raw), sc.dataId);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        merged = deepMerge(merged, parsed as Record<string, unknown>);
      } else {
        logger.warn(`[openclaw-nacos] skip non-object dataId=${sc.dataId}`);
      }
    }

    if (cc.applicationDataId) {
      const dataId = expandDataIdTemplate(cc.applicationDataId, profile);
      const group = DEFAULT_GROUP;
      const raw = await client.getConfig(dataId, group);
      if (raw != null && String(raw).trim() !== "") {
        const parsed = parseConfigBody(String(raw), dataId);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          merged = deepMerge(merged, parsed as Record<string, unknown>);
        }
      }
    }

    for (const pluginId of cc.pluginConfigIds ?? []) {
      const dataId = `${pluginId}-${profile}.json`;
      const group = DEFAULT_GROUP;
      const raw = await client.getConfig(dataId, group);
      if (raw == null || String(raw).trim() === "") {
        logger.debug?.(`[openclaw-nacos] no plugin config for ${dataId}`);
        continue;
      }
      const parsed = parseConfigBody(String(raw), dataId);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        logger.warn(`[openclaw-nacos] plugin ${pluginId}: expected object in ${dataId}`);
        continue;
      }
      const plugins = (merged.plugins as Record<string, unknown> | undefined) ?? {};
      const entries = (plugins.entries as Record<string, unknown> | undefined) ?? {};
      const prevEntry = (entries[pluginId] as Record<string, unknown> | undefined) ?? {};
      const prevConfig = (prevEntry.config as Record<string, unknown> | undefined) ?? {};
      const nextConfig = deepMerge(prevConfig, parsed as Record<string, unknown>);
      entries[pluginId] = { ...prevEntry, config: nextConfig };
      plugins.entries = entries;
      merged.plugins = plugins;
    }

    merged = expandEnvPlaceholdersInValue(merged, env) as Record<string, unknown>;

    validateMergedConfig(merged, cc.skipValidation, logger);
    if (
      expectedGeneration !== undefined &&
      (this.stopping || expectedGeneration !== this.lifecycleGeneration)
    ) {
      logger.debug("[openclaw-nacos] discard stale config pull after lifecycle change");
      return;
    }
    backupOpenClawConfig(stateDir, env, logger);
    await replaceConfig(merged);
    deps.onApplied?.();
    logger.info("[openclaw-nacos] merged Nacos config applied via replaceConfig");
  }

  /**
   * Creates the client, runs initial pull, and registers subscribers.
   */
  async start(deps: ConfigSyncDeps): Promise<void> {
    const generation = ++this.lifecycleGeneration;
    this.stopping = false;
    this.deps = deps;
    const cc = deps.pluginConfig.configCenter;
    if (!cc?.enabled) {
      this.deps = null;
      return;
    }

    const opts = buildNacosConfigClientOptions(deps.pluginConfig);
    const client = new NacosConfigClient({
      ...opts,
      logger: createNacosSdkLogger(deps.logger),
    } as never);
    this.client = client;

    try {
      await this.pullAndApply(deps, client, generation);

      const profile = resolveProfile(cc.profile, deps.env);
      const subscribeOne = async (dataId: string, group: string, refresh?: boolean) => {
        if (refresh === false) return;
        const listener = () => this.schedulePull();
        await Promise.resolve(client.subscribe({ dataId, group }, listener));
        this.unsubscribeFns.push(() => {
          client.unSubscribe({ dataId, group }, listener);
        });
      };

      for (const sc of cc.sharedConfigs ?? []) {
        await subscribeOne(sc.dataId, resolveGroupName(sc.group), sc.refresh);
      }
      if (cc.primaryConfigDataId) {
        const dataId = expandDataIdTemplate(cc.primaryConfigDataId, profile);
        await subscribeOne(dataId, resolveGroupName(cc.primaryConfigGroup), true);
      }
      if (cc.applicationDataId) {
        await subscribeOne(expandDataIdTemplate(cc.applicationDataId, profile), DEFAULT_GROUP, true);
      }
      for (const pluginId of cc.pluginConfigIds ?? []) {
        await subscribeOne(`${pluginId}-${profile}.json`, DEFAULT_GROUP, true);
      }
    } catch (error) {
      // 初始拉取或任一订阅失败都不能遗留长轮询客户端。
      await this.stop(deps.logger);
      throw error;
    }
  }

  private schedulePull(): void {
    if (!this.deps || this.stopping) return;
    this.pullRequested = true;
    if (this.runningPull) return;
    const generation = this.lifecycleGeneration;
    const runLogger = this.deps.logger;
    const runOnError = this.deps.onError;
    this.runningPull = (async () => {
      try {
        while (this.pullRequested && !this.stopping && generation === this.lifecycleGeneration) {
          this.pullRequested = false;
          const d = this.deps;
          const client = this.client;
          if (d && client) {
            await this.pullAndApply(d, client, generation);
          }
        }
      } catch (err) {
        // stop/hot reload 会主动关闭旧客户端，正在进行的 getConfig 随后失败是正常的
        // 生命周期收尾，不能让旧代错误覆盖新实例或已清空的健康状态。
        if (!this.stopping && generation === this.lifecycleGeneration) {
          runOnError?.(err);
          runLogger.error(`[openclaw-nacos] config pull failed: ${String(err)}`);
        }
      } finally {
        this.runningPull = null;
        // hot reload 可能在旧代拉取结束前启动新代；补触发一次，避免新代事件被旧 Promise 挡住。
        if (this.pullRequested && this.deps && !this.stopping) {
          this.schedulePull();
        }
      }
    })();
  }

  /**
   * Stops subscriptions and closes the client.
   */
  async stop(logger: PluginLog): Promise<void> {
    this.stopping = true;
    this.lifecycleGeneration += 1;
    this.pullRequested = false;
    for (const fn of this.unsubscribeFns) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    this.unsubscribeFns = [];
    const c = this.client;
    this.client = null;
    this.deps = null;
    await tryCloseNacosClient(c, logger, "config");
  }
}
