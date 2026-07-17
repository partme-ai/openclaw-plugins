/**
 * Bridge 当前 OpenClaw Runtime 的进程内引用。
 *
 * 仅在完整插件注册后写入，供诊断与扩展组件读取；停止或测试结束必须清空，避免热重载
 * 后继续持有旧 logger/runtime。该引用不是跨进程状态，也不能作为健康事实来源。
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

/** Bridge 扩展组件实际需要的最小宿主能力，避免传播完整 Plugin API。 */
export type BridgeRuntime = Pick<OpenClawPluginApi, "runtime" | "logger">;

let currentRuntime: BridgeRuntime | null = null;

/** 从完整 OpenClaw Plugin API 提取不带注册副作用的最小运行时视图。 */
export function bridgeRuntime(api: OpenClawPluginApi): BridgeRuntime {
  return { runtime: api.runtime, logger: api.logger };
}

/** 保存 full registration 的进程内运行时，供诊断和扩展组件读取。 */
export function setBridgeRuntime(api: OpenClawPluginApi): BridgeRuntime {
  const value = bridgeRuntime(api);
  currentRuntime = value;
  return value;
}

/** 返回当前 full registration 运行时；尚未注册或已停止时返回 `null`。 */
export function getBridgeRuntime(): BridgeRuntime | null {
  return currentRuntime;
}

/** 在显式停止、热重载或测试清理时释放进程内宿主引用。 */
export function clearBridgeRuntime(): void {
  currentRuntime = null;
}
