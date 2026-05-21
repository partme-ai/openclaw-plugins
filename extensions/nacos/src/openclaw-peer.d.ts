/**
 * Peer dependency `openclaw` placeholder types for local build and IDE when openclaw is not linked.
 *
 * Aligns with https://docs.openclaw.ai/plugins/sdk-entrypoints and
 * https://docs.openclaw.ai/plugins/sdk-runtime (`api.runtime.config`).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "openclaw/plugin-sdk/plugin-entry" {
  export type PluginRegistrationMode = "full" | "setup-only" | "setup-runtime" | "cli-metadata" | "discovery" | "tool-discovery";

  export type OpenClawPluginReloadRegistration = {
    restartPrefixes?: string[];
    hotPrefixes?: string[];
    noopPrefixes?: string[];
  };

  export type OpenClawPluginConfigSchema = any;

  export type OpenClawPluginApi = {
    id: string;
    name: string;
    registrationMode: PluginRegistrationMode;
    pluginConfig?: Record<string, unknown>;
    runtime: {
      config: {
        current: () => Record<string, unknown> | Promise<Record<string, unknown>>;
        loadConfig: () => Record<string, unknown> | Promise<Record<string, unknown>>;
        writeConfigFile: (next: Record<string, unknown>, options?: unknown) => Promise<void>;
        replaceConfigFile: (
          next: Record<string, unknown>,
          options?: { afterWrite: { mode: "auto" | "restart" | "none"; reason?: string } },
        ) => Promise<{ followUp?: unknown }>;
      };
    };
    registerService: (service: {
      id: string;
      start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
      stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
    }) => void;
    registerCli: (
      registrar: (program: Record<string, unknown>) => void,
      opts?: { descriptors?: Array<{ name: string; description: string }> },
    ) => void;
    registerHttpRoute: (route: {
      method: string;
      path: string;
      auth?: string;
      match?: string;
      handler: (req: Record<string, unknown>, res: Record<string, unknown>) => void | Promise<void>;
    }) => void;
  };

  export type OpenClawPluginServiceContext = {
    config: Record<string, unknown>;
    workspaceDir?: string;
    stateDir: string;
    logger: {
      info: (msg: string) => void;
      warn: (msg: string) => void;
      error: (msg: string) => void;
      debug: (msg: string) => void;
    };
  };

  export function definePluginEntry(opts: {
    id: string;
    name: string;
    description: string;
    configSchema?: OpenClawPluginConfigSchema | (() => OpenClawPluginConfigSchema);
    reload?: OpenClawPluginReloadRegistration;
    register: (api: OpenClawPluginApi) => void;
  }): unknown;

  export function emptyPluginConfigSchema(): OpenClawPluginConfigSchema;
}

declare module "openclaw/plugin-sdk/setup-runtime" {
  export type SetupPluginEntry = { id: string; plugin: Record<string, unknown> };
  export function defineSetupPluginEntry(plugin: Record<string, unknown>): SetupPluginEntry;
}
