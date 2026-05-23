/**
 * Web STOMP Runtime 引用存储。
 */

export type WebStompRuntime = {
  config: Record<string, unknown>;
  channel: {
    routing: {
      resolveAgentRoute(params: {
        cfg: Record<string, unknown>;
        channel: string;
        accountId: string;
        peer: { kind: string; id: string };
      }): Promise<Record<string, unknown>>;
    };
    reply: {
      finalizeInboundContext(params: Record<string, unknown>): Promise<Record<string, unknown>>;
      createReplyDispatcherWithTyping(params: {
        deliver: (payload: { text: string }) => Promise<void>;
      }): Record<string, unknown>;
      dispatchReplyFromConfig(params: Record<string, unknown>): Promise<void>;
    };
  };
};

let runtimeRef: WebStompRuntime | null = null;

/** 注入 Gateway runtime。 */
export function setWebStompRuntime(runtime: unknown): void {
  runtimeRef = runtime as WebStompRuntime;
}

/** 获取 runtime。 */
export function getWebStompRuntime(): WebStompRuntime {
  if (!runtimeRef) {
    throw new Error("[openclaw_web_stomp] runtime is not initialized");
  }
  return runtimeRef;
}
