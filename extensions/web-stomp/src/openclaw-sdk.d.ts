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
  export function defineChannelPluginEntry(opts: {
    id: string;
    name: string;
    description: string;
    plugin: ChannelPlugin;
    registerFull?: (api: OpenClawPluginApi) => void;
  }): {
    id: string;
    name: string;
    description: string;
    register: (api: OpenClawPluginApi) => void;
  };
}
