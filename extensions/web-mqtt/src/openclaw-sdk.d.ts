declare module "openclaw/plugin-sdk/core" {
  export type OpenClawPluginApi = {
    id: string;
    runtime: unknown;
    config: unknown;
    pluginConfig?: Record<string, unknown>;
    registrationMode?: "full" | "setup-only" | "setup-runtime" | "cli-metadata";
    registerChannel: (registration: unknown) => void;
    registerHttpRoute: (route: unknown) => void;
    registerService: (svc: {
      id: string;
      start: (ctx?: unknown) => void | Promise<void>;
      stop?: (ctx?: unknown) => void | Promise<void>;
    }) => void;
  };
  export type ChannelPlugin = unknown;
  export type PluginRuntime = any;
}

declare module "openclaw/plugin-sdk/channel-core" {
  export function defineChannelPluginEntry(opts: {
    id: string;
    name: string;
    description: string;
    plugin: unknown;
    setRuntime?: (runtime: unknown) => void;
    registerFull?: (api: import("openclaw/plugin-sdk/core").OpenClawPluginApi) => void;
  }): unknown;
  export function defineSetupPluginEntry(plugin: unknown): unknown;
}

declare module "openclaw/plugin-sdk/runtime-store" {
  export type PluginRuntime = any;
  export function createPluginRuntimeStore<T>(errorMessage: string): {
    setRuntime(runtime: T): void;
    getRuntime(): T;
    tryGetRuntime(): T | null;
  };
}

declare module "openclaw/plugin-sdk" {
  export type ChannelAccountSnapshot = Record<string, unknown>;
  export type ChannelGatewayContext<T = unknown> = {
    account: T;
    setStatus: (status: Record<string, unknown>) => void;
  };
  export type OpenClawConfig = Record<string, unknown>;
  export type ChannelPlugin<T = unknown> = Record<string, unknown> & { _account?: T };
  export function deleteAccountFromConfigSection(args: Record<string, unknown>): Record<string, unknown>;
  export function setAccountEnabledInConfigSection(args: Record<string, unknown>): Record<string, unknown>;
}

declare module "openclaw/plugin-sdk/setup" {
  export type ChannelSetupAdapter = unknown;
  export type ChannelSetupWizard = {
    channel: string;
    status?: unknown;
    introNote?: unknown;
    credentials?: unknown[];
    textInputs?: unknown[];
    finalize?: unknown;
    completionNote?: unknown;
    disable?: (cfg: import("openclaw/plugin-sdk").OpenClawConfig) => unknown;
  };
  export function applySetupAccountConfigPatch(args: Record<string, unknown>): unknown;
  export function createPatchedAccountSetupAdapter(opts: Record<string, unknown>): ChannelSetupAdapter;
  export function createStandardChannelSetupStatus(opts: Record<string, unknown>): unknown;
  export function setSetupChannelEnabled(cfg: unknown, channel: string, enabled: boolean): unknown;
}

declare module "@partme.ai/openclaw-message-sdk/bridge" {
  export type BridgePluginRuntime = unknown;
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
