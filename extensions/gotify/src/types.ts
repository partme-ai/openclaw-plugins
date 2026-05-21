/**
 * Gotify 配置与消息类型定义。
 */

export interface GotifyStreamConfig {
  enabled?: boolean;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  maxReconnectAttempts?: number;
  /** 入站派发成功后从 Gotify 删除消息；开发/测试可设为 false 便于在 Gotify App 对照 */
  deleteAfterConsume?: boolean;
}

export interface GotifyBootstrapConfig {
  enabled?: boolean;
  autoCreateApplication?: boolean;
  applicationName?: string;
  applicationDescription?: string;
}

export type GotifyDmPolicy = 'open' | 'allowlist' | 'pairing' | 'disabled';

export interface GotifyAccountConfig {
  enabled?: boolean;
  name?: string;
  serverUrl?: string;
  appToken?: string;
  clientToken?: string;
  defaultPriority?: number;
  dmPolicy?: GotifyDmPolicy;
  allowFrom?: Array<string | number>;
  inbound?: GotifyStreamConfig;
  bootstrap?: GotifyBootstrapConfig;
}

export interface GotifyChannelConfig extends GotifyAccountConfig {
  defaultAccount?: string;
  accounts?: Record<string, GotifyAccountConfig>;
}

export interface ResolvedGotifyAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  serverUrl: string | null;
  appToken: string | null;
  clientToken: string | null;
  defaultPriority: number;
  dmPolicy: GotifyDmPolicy;
  allowFrom: string[];
  inbound: Required<GotifyStreamConfig>;
  bootstrap: Required<GotifyBootstrapConfig>;
}

export interface GotifyMessagePayload {
  message: string;
  title?: string;
  priority?: number;
  extras?: Record<string, unknown>;
}

export interface GotifyMessageResponse {
  id: number | string;
  appid?: number | string;
  title?: string;
  message?: string;
  priority?: number;
  extras?: Record<string, unknown>;
  date?: string;
}

export interface GotifyApplicationInfo {
  id: number;
  name: string;
  description?: string;
  token?: string;
  internal?: boolean;
}

export interface GotifyClientInfo {
  id: number;
  name?: string;
  token?: string;
}

export interface GotifyDoctorReport {
  ok: boolean;
  serverUrl: string | null;
  hasAppToken: boolean;
  hasClientToken: boolean;
  healthOk: boolean;
  applicationsChecked: boolean;
  clientsChecked: boolean;
  errors: string[];
}

export interface GotifyPagedMessages {
  messages: GotifyMessageResponse[];
  paging: {
    size: number;
    limit: number;
    next: string | null;
    since: number;
  };
}

export interface GotifyStreamEnvelope extends GotifyMessageResponse {
  event?: string;
}

export interface GotifyRuntimeSnapshot {
  running: boolean;
  lastStartAt: number | null;
  lastStopAt: number | null;
  lastError: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}
