/**
 * 【可选运营模块 — ICS Utils】配置热重载触发工具
 *
 * 仅供 `src/ics/handlers/` 使用；ICS REST 修改 openclaw.json 后通知 Gateway 重载。
 *
 * OpenClaw Gateway 支持 hybrid 热重载模式（默认）：
 * - 安全变更热应用
 * - 关键变更自动进程内重启（SIGUSR1）
 *
 * 重载策略（按优先级）：
 * 1. runtime.gatewayCall("config.reload") — 通过 Gateway API 触发
 * 2. runtime.invoke("config_reload") — 通用调用
 * 3. 文件监听自动检测 — Gateway hybrid 模式的默认行为
 */

import type { GatewayRuntime } from "../../types.js";

/** 防抖计时器 */
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

/** 默认防抖间隔（ms） */
const DEFAULT_DEBOUNCE_MS = 2000;

/**
 * 触发 Gateway 配置重载
 * 使用防抖机制避免频繁重载
 *
 * @param runtime - Gateway Runtime 引用
 * @param debounceMs - 防抖间隔（默认 2000ms）
 */
export async function triggerConfigReload(
  runtime: GatewayRuntime | Record<string, unknown>,
  debounceMs: number = DEFAULT_DEBOUNCE_MS
): Promise<void> {
  // 清除之前的防抖计时器
  if (reloadTimer) {
    clearTimeout(reloadTimer);
  }

  // 防抖触发
  return new Promise<void>((resolve) => {
    reloadTimer = setTimeout(async () => {
      reloadTimer = null;
      await executeReload(runtime);
      resolve();
    }, debounceMs);
  });
}

/**
 * 立即执行配置重载（无防抖）
 *
 * @param runtime - Gateway Runtime 引用
 */
async function executeReload(
  runtime: GatewayRuntime | Record<string, unknown>
): Promise<void> {
  const runtimeAny = runtime as Record<string, unknown>;

  try {
    // 策略 1: gatewayCall
    if (typeof runtimeAny.gatewayCall === "function") {
      await (runtimeAny.gatewayCall as (m: string) => Promise<unknown>)("config.reload");
      console.log("[openclaw_ics] Config reload triggered via gatewayCall");
      return;
    }

    // 策略 2: invoke
    if (typeof runtimeAny.invoke === "function") {
      await (runtimeAny.invoke as (m: string) => Promise<unknown>)("config_reload");
      console.log("[openclaw_ics] Config reload triggered via invoke");
      return;
    }

    // 策略 3: 依赖文件监听自动检测
    console.log(
      "[openclaw_ics] Config changed. No direct reload API available — " +
      "relying on Gateway hybrid file watcher for auto-reload."
    );
  } catch (error) {
    console.error("[openclaw_ics] Config reload trigger failed:", error);
    console.log(
      "[openclaw_ics] Falling back to file watcher auto-reload. " +
      "Changes will take effect when Gateway detects the file modification."
    );
  }
}

/**
 * 安全地更新配置的特定字段
 * 使用文件锁避免并发写入冲突
 *
 * @param configPath - 配置文件路径
 * @param updater - 配置更新函数
 */
export async function safeConfigUpdate(
  configPath: string,
  updater: (config: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  // 动态导入 file-ops 避免循环依赖
  const { readOpenClawConfig, writeOpenClawConfig } = await import("./file-ops.js");

  // 读取当前配置
  const config = await readOpenClawConfig(configPath);

  // 应用更新
  const updated = updater(config);

  // 写回配置
  await writeOpenClawConfig(configPath, updated);

  console.log("[openclaw_ics] Config updated successfully");
}
