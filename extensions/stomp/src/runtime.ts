/**
 * @fileoverview STOMP 插件进程内单例：缓存 Bridge 型 PluginRuntime。
 *
 * @description
 * inbound dispatch 需访问 routing.resolveAgentRoute 与 reply 管线；
 * transport 层通过本模块获取 runtime，避免与 index 循环依赖。
 *
 * @module runtime
 */

/**
 * STOMP 插件 Runtime — Base Profile 入口。
 */

/** @description STOMP 插件所需的最小 Runtime 形状（routing + reply）。 */
export interface StompRuntime {
  config: Record<string, unknown>;
  channel: {
    routing: {
      resolveAgentRoute(params: {
        cfg: Record<string, unknown>;
        channel: string;
        accountId: string;
        peer: { kind: string; id: string };
      }): Promise<{ agentId: string; [key: string]: unknown }>;
    };
    reply: {
      finalizeInboundContext(params: {
        channel: string;
        accountId: string;
        from: string;
        text: string;
        chatType: string;
        extra?: Record<string, unknown>;
      }): Promise<Record<string, unknown>>;
      createReplyDispatcherWithTyping(params: {
        deliver: (payload: { text: string }) => Promise<void>;
      }): Record<string, unknown>;
      dispatchReplyFromConfig(params: {
        ctx: Record<string, unknown>;
        cfg: Record<string, unknown>;
        dispatcher: Record<string, unknown>;
        replyOptions: { agentId: string; [key: string]: unknown };
      }): Promise<void>;
    };
  };
}

let runtimeRef: StompRuntime | null = null;

/**
 * @description 设置插件 runtime（由入口 setRuntime 注入）。
 * @param runtime - 宿主 PluginRuntime（cast 为 StompRuntime）。
 * @returns void
 * @throws 不抛出。
 */
export function setStompRuntime(runtime: unknown): void {
  runtimeRef = runtime as StompRuntime;
}

/**
 * @description 获取 runtime；未初始化时抛错以便尽早暴露装配问题。
 * @returns 已注入的 `StompRuntime`。
 * @throws 未调用 `setStompRuntime` 时抛出 Error。
 */
export function getStompRuntime(): StompRuntime {
  if (!runtimeRef) {
    throw new Error("[openclaw-stomp] runtime is not initialized");
  }
  return runtimeRef;
}

/**
 * @description 在测试或热重载场景中清空 runtime 引用。
 * @returns void
 * @throws 不抛出。
 */
export function clearStompRuntime(): void {
  runtimeRef = null;
}
