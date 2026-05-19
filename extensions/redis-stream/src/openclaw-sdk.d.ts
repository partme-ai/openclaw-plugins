/**
 * Peer dependency `openclaw` placeholder types for local build and CI when openclaw is not installed.
 */

declare module "openclaw/plugin-sdk/core" {
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
    channel: {
      routing: {
        resolveAgentRoute: (params: {
          cfg: Record<string, unknown>;
          channel: string;
          accountId: string;
          peer: { kind: string; id: string };
        }) => Promise<any>;
      };
      reply: {
        finalizeInboundContext: (params: {
          channel: string;
          accountId: string;
          from: string;
          text: string;
          chatType: string;
          extra?: Record<string, unknown>;
        }) => Promise<any>;
        createReplyDispatcherWithTyping: (params: { deliver: (payload: { text: string }) => Promise<void> }) => any;
        dispatchReplyFromConfig: (params: {
          ctx: any;
          cfg: Record<string, unknown>;
          dispatcher: any;
          replyOptions: any;
        }) => Promise<void>;
      };
    };
  };

  export type OpenClawPluginApi = {
    id: string;
    runtime: PluginRuntime;
    registerChannel: (registration: { plugin: any }) => void;
    registerHttpRoute: (params: OpenClawPluginHttpRouteParams) => void;
    registerCli: (
      registrar: () => { descriptors: Array<{ name: string; description: string }> },
      opts?: { lazy?: boolean },
    ) => void;
  };
}

declare module "openclaw/plugin-sdk/channel-core" {
  import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk/core";

  export function defineChannelPluginEntry<TPlugin>(opts: {
    id: string;
    name: string;
    description: string;
    plugin: TPlugin;
    setRuntime?: (runtime: PluginRuntime) => void;
    registerCliMetadata?: (api: OpenClawPluginApi) => void;
    registerFull?: (api: OpenClawPluginApi) => void;
  }): unknown;

  export function defineSetupPluginEntry<TPlugin>(plugin: TPlugin): { plugin: TPlugin };
}
