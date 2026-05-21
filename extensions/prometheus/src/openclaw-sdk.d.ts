declare module "openclaw/plugin-sdk/core" {
  /** 与 OpenClaw Gateway `PluginHookName` 对齐（见源码 `plugins/hook-types.ts`） */
  type PluginHookName =
    | "before_model_resolve"
    | "before_prompt_build"
    | "before_agent_start"
    | "before_agent_reply"
    | "llm_input"
    | "llm_output"
    | "agent_end"
    | "before_compaction"
    | "after_compaction"
    | "before_reset"
    | "inbound_claim"
    | "message_received"
    | "message_sending"
    | "message_sent"
    | "before_tool_call"
    | "after_tool_call"
    | "tool_result_persist"
    | "before_message_write"
    | "session_start"
    | "session_end"
    | "subagent_spawning"
    | "subagent_delivery_target"
    | "subagent_spawned"
    | "subagent_ended"
    | "gateway_start"
    | "gateway_stop"
    | "before_dispatch"
    | "reply_dispatch"
    | "before_install";

  type PluginHookContext = Record<string, unknown>;
  type PluginHookHandler = (event: any, ctx: PluginHookContext) => void | Promise<void>;

  type RuntimeLogger = {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
    debug?: (message: string, meta?: Record<string, unknown>) => void;
  };

  type PluginRuntime = {
    system?: {
      runHeartbeatOnce?: (options?: { reason?: string }) => Promise<unknown>;
    };
    events?: {
      onAgentEvent?: (listener: (event: any) => void) => (() => void) | void;
      onSessionTranscriptUpdate?: (listener: (event: any) => void) => (() => void) | void;
    };
    logging?: {
      getChildLogger?: (bindings?: Record<string, unknown>, opts?: { level?: string }) => RuntimeLogger;
    };
    state?: {
      resolveStateDir?: () => string;
    };
    channel?: {
      activity?: {
        get?: (params: { channel: string; accountId?: string | null }) => {
          inboundAt: number | null;
          outboundAt: number | null;
        };
      };
    };
    modelAuth?: {
      resolveApiKeyForProvider?: (params: {
        provider: string;
        cfg?: Record<string, unknown>;
      }) => Promise<{
        apiKey?: string;
        profileId?: string;
        source: string;
        mode: string;
      }>;
    };
  };

  export type OpenClawPluginApi = {
    id: string;
    name?: string;
    registrationMode?: "full" | "setup-only" | "setup-runtime" | "cli-metadata";
    runtime: PluginRuntime;
    config: Record<string, unknown>;
    pluginConfig?: Record<string, unknown>;
    logger: RuntimeLogger;
    registerHttpRoute: (route: {
      path: string;
      /** OpenClaw 必填：`gateway` 需 Gateway 鉴权；`plugin` 由插件自行鉴权（本插件可选 Bearer） */
      auth: "gateway" | "plugin";
      handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void | Promise<void>;
    }) => void;
    registerService: (service: {
      id: string;
      start: (ctx: {
        config: Record<string, unknown>;
        workspaceDir?: string;
        stateDir: string;
        logger: RuntimeLogger;
      }) => void | Promise<void>;
      stop?: (ctx: {
        config: Record<string, unknown>;
        workspaceDir?: string;
        stateDir: string;
        logger: RuntimeLogger;
      }) => void | Promise<void>;
    }) => void;
    on: (hookName: PluginHookName, handler: PluginHookHandler, opts?: { priority?: number }) => void;
    registerGatewayMethod?: (
      method: string,
      handler: (req: unknown, res: { respond: (ok: boolean, payload?: unknown, error?: unknown) => void }) => void | Promise<void>,
      opts?: { scope?: string },
    ) => void;
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
