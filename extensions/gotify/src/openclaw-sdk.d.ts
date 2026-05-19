/* eslint-disable @typescript-eslint/no-explicit-any */

declare module 'openclaw/plugin-sdk/core' {
  export type OpenClawPluginApi = {
    id: string;
    runtime: any;
    pluginConfig?: Record<string, unknown>;
    registrationMode?: 'full' | 'setup-only' | 'setup-runtime' | 'cli-metadata';
    registerChannel: (registration: { plugin: any }) => void;
    registerHttpRoute: (params: {
      path: string;
      handler: (
        req: import('node:http').IncomingMessage,
        res: import('node:http').ServerResponse
      ) => void | Promise<void>;
      auth?: string;
      match?: 'exact' | 'prefix';
    }) => void;
    registerCommand?: (command: any) => void;
  };
}

declare module 'openclaw/plugin-sdk/channel-core' {
  export function defineChannelPluginEntry(opts: {
    id: string;
    name: string;
    description: string;
    plugin: unknown;
    setRuntime?: (runtime: unknown) => void;
    registerFull?: (api: import('openclaw/plugin-sdk/core').OpenClawPluginApi) => void;
  }): unknown;

  export function defineSetupPluginEntry<TPlugin>(plugin: TPlugin): { plugin: TPlugin };
}

declare module 'openclaw/plugin-sdk' {
  export type OpenClawConfig = Record<string, unknown>;
  export type ChannelAccountSnapshot = Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export type ChannelPlugin<T> = Record<string, unknown>;
  export type ChannelGatewayContext<T = unknown> = {
    cfg: OpenClawConfig;
    accountId: string;
    account: T;
    runtime: any;
    abortSignal: AbortSignal;
    setStatus: (next: Record<string, unknown>) => void;
    channelRuntime?: {
      reply: {
        finalizeInboundContext: (params: any) => Promise<any>;
        createReplyDispatcherWithTyping: (params: any) => any;
        dispatchReplyFromConfig: (params: any) => Promise<any>;
        dispatchReplyWithBufferedBlockDispatcher: (params: any) => Promise<any>;
      };
      routing: {
        resolveAgentRoute: (params: any) => Promise<any>;
      };
    };
  };
  export type ChannelOutboundContext = {
    cfg: OpenClawConfig;
    to: string;
    text: string;
    accountId?: string | null;
    title?: string | null;
    priority?: number | null;
    extras?: Record<string, unknown> | null;
  };
  export type OutboundDeliveryResult = {
    channel: string;
    messageId: string;
    [key: string]: unknown;
  };
  export type ChannelOutboundAdapter = {
    deliveryMode: 'direct' | 'gateway' | 'hybrid';
    sendText?: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
  };
  export function deleteAccountFromConfigSection(params: {
    cfg: OpenClawConfig;
    sectionKey: string;
    accountId: string;
    clearBaseFields?: string[];
  }): OpenClawConfig;
  export function setAccountEnabledInConfigSection(params: {
    cfg: OpenClawConfig;
    sectionKey: string;
    accountId: string;
    enabled: boolean;
    allowTopLevel?: boolean;
  }): OpenClawConfig;
}
