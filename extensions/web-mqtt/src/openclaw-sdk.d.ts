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
