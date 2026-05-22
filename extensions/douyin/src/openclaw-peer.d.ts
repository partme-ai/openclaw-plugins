/**
 * Peer 依赖 `openclaw` 的占位类型，便于在未执行 OpenClaw 完整构建时完成本包 d.ts 与 IDE 检查。
 * 运行时已安装 openclaw 时使用其真实类型定义。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "openclaw/plugin-sdk/account-resolution" {
  export const DEFAULT_ACCOUNT_ID: string;
  export function listCombinedAccountIds(...args: any[]): any;
  export function normalizeAccountId(...args: any[]): any;
  export function resolveMergedAccountConfig<T = unknown>(...args: any[]): T;
  export type OpenClawConfig = Record<string, unknown>;
}

declare module "openclaw/plugin-sdk/channel-config-helpers" {
  export function createHybridChannelConfigAdapter<T = unknown>(...args: any[]): any;
}

declare module "openclaw/plugin-sdk/channel-lifecycle" {
  export function waitUntilAbort(...args: any[]): any;
}

declare module "openclaw/plugin-sdk/channel-send-result" {
  export function createEmptyChannelResult(...args: any[]): any;
}

declare module "openclaw/plugin-sdk/core" {
  export function defineChannelPluginEntry(...args: any[]): any;
  export function createChatChannelPlugin(...args: any[]): any;
  export type OpenClawPluginApi = any;
  export type ChannelPlugin<T = any> = any;
  export type PluginRuntime = any;
}

declare module "openclaw/plugin-sdk/directory-runtime" {
  export function createEmptyChannelDirectoryAdapter(...args: any[]): any;
}

declare module "openclaw/plugin-sdk/webhook-ingress" {
  export function registerPluginHttpRoute(...args: any[]): any;
}

declare module "openclaw/plugin-sdk/channel-inbound" {
  export function dispatchInboundDirectDmWithRuntime(...args: any[]): Promise<any>;
}

declare module "openclaw/plugin-sdk/runtime-store" {
  export function createPluginRuntimeStore<T = unknown>(...args: any[]): any;
}

declare module "openclaw/plugin-sdk/setup" {
  export function createPatchedAccountSetupAdapter(...args: any[]): any;
  export type ChannelSetupAdapter = any;
  export type ChannelSetupWizard = any;
  export function applySetupAccountConfigPatch(...args: any[]): any;
  export function createStandardChannelSetupStatus(...args: any[]): any;
  export function setSetupChannelEnabled(...args: any[]): any;
}

declare module "@partme.ai/openclaw-message-sdk/bridge" {
  export type BridgePluginRuntime = any;
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
