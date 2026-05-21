/* eslint-disable @typescript-eslint/no-explicit-any */

declare module 'openclaw/plugin-sdk/core' {
  export type OpenClawConfig = Record<string, unknown>;
  // Generic preserved for call sites (e.g. ChannelPlugin<ResolvedGotifyAccount>); account type is not used in this stub.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export type ChannelPlugin<T = unknown> = Record<string, unknown>;
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

declare module 'openclaw/plugin-sdk/channel-contract' {
  export type ChannelAccountSnapshot = Record<string, unknown>;
  export type ChannelGatewayContext<T = unknown> = {
    cfg: import('openclaw/plugin-sdk/core').OpenClawConfig;
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
      session?: {
        resolveStorePath: (store: string | undefined, opts: { agentId: string }) => string;
        recordInboundSession: (params: any) => Promise<void>;
      };
      /** Host channel kernel (Feishu/IRC 同款 turn 管线，写入 transcript + 派发 Agent)。 */
      turn?: {
        runAssembled: (params: any) => Promise<unknown>;
      };
    };
  };
  export type ChannelOutboundContext = {
    cfg: import('openclaw/plugin-sdk/core').OpenClawConfig;
    to: string;
    text: string;
    accountId?: string | null;
    title?: string | null;
    priority?: number | null;
    extras?: Record<string, unknown> | null;
  };
  export type ChannelOutboundAdapter = {
    deliveryMode: 'direct' | 'gateway' | 'hybrid';
    sendText?: (ctx: ChannelOutboundContext) => Promise<{ channel: string; messageId: string }>;
  };
}

declare module 'openclaw/plugin-sdk/channel-ingress-runtime' {
  export function defineStableChannelIngressIdentity(params?: {
    normalize?: (value: string) => string | null | undefined;
    aliases?: Array<{
      key: string;
      kind?: string;
      normalizeEntry?: (value: string) => string | null | undefined;
      normalizeSubject?: (value: string) => string | null | undefined;
    }>;
    isWildcardEntry?: (value: string) => boolean;
  }): unknown;

  export function resolveChannelMessageIngress(params: Record<string, unknown>): Promise<{
    senderAccess: {
      allowed: boolean;
      decision: string;
      reasonCode: string;
      effectiveAllowFrom: string[];
    };
    ingress: Record<string, unknown>;
  }>;
}

declare module 'openclaw/plugin-sdk/channel-config-helpers' {
  export function createScopedDmSecurityResolver<TAccount>(params: {
    channelKey: string;
    resolvePolicy: (account: TAccount) => string | null | undefined;
    resolveAllowFrom: (account: TAccount) => Array<string | number> | null | undefined;
    defaultPolicy?: string;
    approveHint?: string;
    normalizeEntry?: (raw: string) => string;
  }): (ctx: {
    cfg: import('openclaw/plugin-sdk/core').OpenClawConfig;
    accountId?: string | null;
    account: TAccount;
  }) => {
    policy: string;
    allowFrom?: Array<string | number> | null;
    allowFromPath: string;
    approveHint: string;
    normalizeEntry?: (raw: string) => string;
  };
}

/** @deprecated Prefer focused subpaths such as plugin-sdk/core and plugin-sdk/channel-contract */
declare module 'openclaw/plugin-sdk' {
  export type OpenClawConfig = import('openclaw/plugin-sdk/core').OpenClawConfig;
  export type ChannelAccountSnapshot =
    import('openclaw/plugin-sdk/channel-contract').ChannelAccountSnapshot;
  export type ChannelPlugin<T = unknown> = import('openclaw/plugin-sdk/core').ChannelPlugin<T>;
  export type ChannelGatewayContext<T = unknown> =
    import('openclaw/plugin-sdk/channel-contract').ChannelGatewayContext<T>;
  export type ChannelOutboundContext =
    import('openclaw/plugin-sdk/channel-contract').ChannelOutboundContext;
  export type ChannelOutboundAdapter =
    import('openclaw/plugin-sdk/channel-contract').ChannelOutboundAdapter;
  export function deleteAccountFromConfigSection(
    params: Parameters<typeof import('openclaw/plugin-sdk/core').deleteAccountFromConfigSection>[0]
  ): import('openclaw/plugin-sdk/core').OpenClawConfig;
  export function setAccountEnabledInConfigSection(
    params: Parameters<
      typeof import('openclaw/plugin-sdk/core').setAccountEnabledInConfigSection
    >[0]
  ): import('openclaw/plugin-sdk/core').OpenClawConfig;
}
