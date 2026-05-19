/**
 * Peer dependency `openclaw` placeholder types for local build and CI when openclaw is not installed.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "openclaw/plugin-sdk/core" {
  export type OpenClawPluginConfigSchema = unknown;

  export type OpenClawPluginHttpRouteParams = {
    path: string;
    handler: (
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse,
    ) => void | Promise<void>;
    auth?: string;
    match?: "exact" | "prefix";
  };

  export type PluginRuntime = {
    config: Record<string, unknown>;
    agent?: {
      resolveAgentDir?: (cfg: Record<string, unknown>, agentId: string) => string;
      resolveAgentWorkspaceDir?: (cfg: Record<string, unknown>, agentId: string) => string;
      resolveAgentTimeoutMs?: (cfg: Record<string, unknown>, agentId?: string) => number;
      runEmbeddedAgent?: (params: any) => Promise<any>;
    };
    subagent?: {
      run?: (params: any) => Promise<{ runId: string }>;
      waitForRun?: (params: any) => Promise<any>;
    };
    channel: {
      routing: {
        resolveAgentRoute: (params: any) => Promise<any>;
      };
      reply: {
        finalizeInboundContext: (params: any) => Promise<any>;
        createReplyDispatcherWithTyping: (params: any) => any;
        dispatchReplyFromConfig: (params: any) => Promise<void>;
      };
    };
  };

  export type OpenClawPluginRegistrationMode =
    | "full"
    | "setup-only"
    | "setup-runtime"
    | "cli-metadata";

  export type OpenClawPluginApi = {
    id: string;
    pluginConfig?: Record<string, unknown>;
    registrationMode?: OpenClawPluginRegistrationMode;
    runtime: PluginRuntime;
    registerChannel: (registration: { plugin: any }) => void;
    registerHttpRoute: (params: OpenClawPluginHttpRouteParams) => void;
    registerTool?: (tool: any, opts?: any) => void;
    registerService?: (service: any) => void;
    on?: (hookName: string, handler: any, opts?: any) => void;
  };

  export function emptyPluginConfigSchema(): OpenClawPluginConfigSchema;
}

/**
 * Channel plugins: https://docs.openclaw.ai/plugins/sdk-channel-plugins
 */
declare module "openclaw/plugin-sdk/channel-core" {
  import type {
    OpenClawPluginApi,
    OpenClawPluginConfigSchema,
    PluginRuntime,
  } from "openclaw/plugin-sdk/core";

  export function defineChannelPluginEntry<TPlugin>(opts: {
    id: string;
    name: string;
    description: string;
    plugin: TPlugin;
    configSchema?: OpenClawPluginConfigSchema | (() => OpenClawPluginConfigSchema);
    setRuntime?: (runtime: PluginRuntime) => void;
    registerCliMetadata?: (api: OpenClawPluginApi) => void;
    registerFull?: (api: OpenClawPluginApi) => void;
  }): unknown;

  export function defineSetupPluginEntry<TPlugin>(plugin: TPlugin): { plugin: TPlugin };
}

declare module "openclaw/plugin-sdk" {
  export type OpenClawConfig = Record<string, unknown>;

  export type PluginRuntime = import("openclaw/plugin-sdk/core").PluginRuntime;

  export type ChannelAccountSnapshot = Record<string, unknown>;

  export type ChannelGatewayContext<T = unknown> = {
    cfg: OpenClawConfig;
    accountId: string;
    account: T;
    runtime: any;
    abortSignal: AbortSignal;
    log?: { info?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void };
    getStatus: () => ChannelAccountSnapshot;
    setStatus: (next: ChannelAccountSnapshot) => void;
    channelRuntime?: PluginRuntime["channel"];
  };

  export type ChannelOutboundContext = {
    cfg: OpenClawConfig;
    to: string;
    text: string;
    accountId?: string | null;
    deps?: any;
    replyToId?: string | null;
  };

  export type OutboundDeliveryResult = {
    channel: string;
    messageId: string;
    [key: string]: unknown;
  };

  export type ChannelOutboundAdapter = {
    deliveryMode: "direct" | "gateway" | "hybrid";
    chunker?: (text: string, limit: number) => string[];
    chunkerMode?: "text" | "markdown";
    textChunkLimit?: number;
    sanitizeText?: (params: { text: string; payload: any }) => string;
    sendText?: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
    [key: string]: unknown;
  };

  export type ChannelPlugin<T = any> = Record<string, unknown>;

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

declare module "openclaw/plugin-sdk/reply-runtime" {
  export function chunkText(text: string, limit: number): string[];
}

declare module "openclaw/plugin-sdk/outbound-runtime" {
  export function sanitizeForPlainText(text: string): string;
}
