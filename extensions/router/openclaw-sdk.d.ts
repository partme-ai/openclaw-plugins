declare module "openclaw/plugin-sdk/core" {
  type PluginHookName =
    | "message_received"
    | "message_sent"
    | "reply_dispatch"
    | "gateway_stop";

  type PluginHookContext = Record<string, unknown>;
  type PluginHookHandler = (event: Record<string, unknown>, ctx: PluginHookContext) => void | Promise<void>;

  type RuntimeLogger = {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
  };

  export type OpenClawPluginApi = {
    id: string;
    runtime: unknown;
    config: unknown;
    pluginConfig?: Record<string, unknown>;
    logger: RuntimeLogger;
    publishInbound?: (params: Record<string, unknown>) => void | Promise<void>;
    on: (hookName: PluginHookName, handler: PluginHookHandler, opts?: { priority?: number }) => void;
  };
}

declare module "openclaw/plugin-sdk/plugin-entry" {
  import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

  export function definePluginEntry(opts: {
    id: string;
    name: string;
    description: string;
    register: (api: OpenClawPluginApi) => void | Promise<void>;
  }): {
    id: string;
    name: string;
    description: string;
    register: (api: OpenClawPluginApi) => void | Promise<void>;
  };
}
