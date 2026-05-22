declare module "@partme.ai/openclaw-message-sdk/bridge" {
  export interface BridgePluginRuntime {
    config: Record<string, unknown>;
    channel: {
      routing: {
        resolveAgentRoute: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
      };
      reply: {
        finalizeInboundContext: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
        createReplyDispatcherWithTyping: (params: Record<string, unknown>) => unknown;
        dispatchReplyFromConfig: (params: Record<string, unknown>) => Promise<void>;
      };
    };
  }
  export function normalizeWireIngress(opts: Record<string, unknown>): {
    accepted: boolean;
    text?: string;
    unified?: unknown;
  };
  export function createChannelDispatch(opts: Record<string, unknown>): Promise<void>;
  export function resolveChannelDispatchIdentity(
    runtime: BridgePluginRuntime,
    opts: Record<string, unknown>,
  ): Promise<{ agentId: string; sessionKey: string }>;
}
