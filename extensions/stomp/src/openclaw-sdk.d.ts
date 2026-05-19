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
}

declare module "openclaw/plugin-sdk/channel-core" {
  import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
  export type ChannelPlugin = unknown;
  export function defineChannelPluginEntry(opts: {
    id: string;
    name: string;
    description: string;
    plugin: ChannelPlugin;
    setRuntime?: (runtime: unknown) => void;
    registerCliMetadata?: (api: import("openclaw/plugin-sdk/core").OpenClawPluginApi) => void;
    registerFull?: (api: OpenClawPluginApi) => void;
  }): {
    id: string;
    name: string;
    description: string;
    register: (api: OpenClawPluginApi) => void;
  };
  export function defineSetupPluginEntry(plugin: ChannelPlugin): { plugin: ChannelPlugin };
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
