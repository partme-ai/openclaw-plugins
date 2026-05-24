/**
 * @module nacos/runtime/nacos-config-sync
 */

import { copyFileSync, existsSync } from "node:fs";
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
  const dest = path.join(stateDir, `openclaw-nacos-${stamp}.json`);
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

/**
 * Pulls shared configs, application dataId, and per-plugin configs from Nacos; deep-merges into current config; backs up; writes.
 */
export class NacosConfigSyncService {
  private client: NacosConfigClient | null = null;
  private unsubscribeFns: Array<() => void> = [];
  private deps: ConfigSyncDeps | null = null;
  private runningPull: Promise<void> | null = null;

  /**
   * Fetches remote config with an existing client and merges into `loadConfig()` snapshot.
   */
  async pullAndApply(
    deps: ConfigSyncDeps,
    clientOverride?: NacosConfigClient,
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
    backupOpenClawConfig(stateDir, env, logger);
    await replaceConfig(merged);
    logger.info("[openclaw-nacos] merged Nacos config applied via replaceConfig");
  }

  /**
   * Creates the client, runs initial pull, and registers subscribers.
   */
  async start(deps: ConfigSyncDeps): Promise<void> {
    this.deps = deps;
    const cc = deps.pluginConfig.configCenter;
    if (!cc?.enabled) {
      return;
    }

    const opts = buildNacosConfigClientOptions(deps.pluginConfig);
    const client = new NacosConfigClient({
      ...opts,
      logger: createNacosSdkLogger(deps.logger),
    } as never);
    this.client = client;

    await this.pullAndApply(deps, client);

    const profile = resolveProfile(cc.profile, deps.env);
    const subscribeOne = (dataId: string, group: string, refresh?: boolean) => {
      if (refresh === false) {
        return;
      }
      const listener = () => {
        void this.schedulePull();
      };
      try {
        client.subscribe({ dataId, group }, listener);
        this.unsubscribeFns.push(() => {
          try {
            client.unSubscribe({ dataId, group }, listener);
          } catch {
            /* ignore */
          }
        });
      } catch (err) {
        deps.logger.warn(`[openclaw-nacos] subscribe failed ${dataId}: ${String(err)}`);
      }
    };

    for (const sc of cc.sharedConfigs ?? []) {
      subscribeOne(sc.dataId, resolveGroupName(sc.group), sc.refresh);
    }
    if (cc.primaryConfigDataId) {
      const dataId = expandDataIdTemplate(cc.primaryConfigDataId, profile);
      subscribeOne(dataId, resolveGroupName(cc.primaryConfigGroup), true);
    }
    if (cc.applicationDataId) {
      subscribeOne(expandDataIdTemplate(cc.applicationDataId, profile), DEFAULT_GROUP, true);
    }
    for (const pluginId of cc.pluginConfigIds ?? []) {
      subscribeOne(`${pluginId}-${profile}.json`, DEFAULT_GROUP, true);
    }
  }

  private schedulePull(): void {
    if (!this.deps || this.runningPull) {
      return;
    }
    this.runningPull = (async () => {
      try {
        const d = this.deps;
        if (d && this.client) {
          await this.pullAndApply(d, this.client);
        }
      } catch (err) {
        this.deps?.logger.error(`[openclaw-nacos] config pull failed: ${String(err)}`);
      } finally {
        this.runningPull = null;
      }
    })();
  }

  /**
   * Stops subscriptions and closes the client.
   */
  async stop(logger: PluginLog): Promise<void> {
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
