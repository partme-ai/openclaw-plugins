/**
 * Runtime 引用存储，避免在多个模块间循环注入。
 */

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
 * 设置插件 runtime（由入口 setRuntime 注入）。
 */
export function setStompRuntime(runtime: unknown): void {
  runtimeRef = runtime as StompRuntime;
}

/**
 * 获取 runtime（未初始化时抛错，便于尽早暴露装配问题）。
 */
export function getStompRuntime(): StompRuntime {
  if (!runtimeRef) {
    throw new Error("[openclaw-stomp] runtime is not initialized");
  }
  return runtimeRef;
}

/**
 * 在测试或重载场景中清空 runtime。
 */
export function clearStompRuntime(): void {
  runtimeRef = null;
}
