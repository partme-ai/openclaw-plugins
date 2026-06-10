/**
 * @description openclaw-prometheus 类型定义：Plugin API、指标模型与 Gateway RPC 响应结构。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// ─────────────────── Plugin API（简化声明） ───────────────────

/**
 * OpenClaw 插件 API 接口
 * 由 Gateway 注入到 register() 函数中
 */
export interface PluginApi {
  /** Gateway 运行时实例 */
  runtime: GatewayRuntime;
  /** 注册 HTTP 路由端点 */
  registerHttpRoute(route: HttpRouteDefinition): void;
  /** 插件就绪回调 */
  onReady(callback: () => Promise<void>): void;
  /** 注册后台服务 */
  registerService?(service: ServiceDefinition): void;
}

/** HTTP 路由定义 */
export interface HttpRouteDefinition {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}

/** 后台服务定义 */
export interface ServiceDefinition {
  name: string;
  start: () => Promise<void>;
  stop?: () => Promise<void>;
}

/**
 * Gateway 运行时
 * 提供对 Gateway 核心功能的访问
 */
export interface GatewayRuntime {
  /** 当前配置 */
  config: Record<string, unknown>;
  system?: {
    runHeartbeatOnce?: (options?: { reason?: string }) => Promise<unknown>;
  };
  events?: {
    onAgentEvent?: (listener: (event: AgentRuntimeEvent) => void) => (() => void) | void;
    onSessionTranscriptUpdate?: (listener: (update: SessionTranscriptUpdate) => void) => (() => void) | void;
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
    }) => Promise<ResolvedProviderAuth>;
  };
}

export interface RuntimeLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  debug?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface ResolvedProviderAuth {
  apiKey?: string;
  profileId?: string;
  source: string;
  mode: string;
}

export interface AgentRuntimeEvent {
  runId: string;
  seq: number;
  stream: string;
  ts: number;
  sessionKey?: string;
  data: Record<string, unknown>;
}

export interface SessionTranscriptUpdate {
  sessionFile: string;
  sessionKey?: string;
  message?: unknown;
  messageId?: string;
}

// ─────────────────── Prometheus 指标类型 ───────────────────

/** Prometheus 指标类型 */
export type MetricType = "gauge" | "counter" | "histogram" | "summary";

/** 单个指标定义 */
export interface MetricDefinition {
  /** 指标名称 */
  name: string;
  /** 帮助说明 */
  help: string;
  /** 指标类型 */
  type: MetricType;
  /** 标签键列表 */
  labels?: string[];
}

/** 指标数据点 */
export interface MetricSample {
  /** 指标名称 */
  name: string;
  /** 标签 */
  labels?: Record<string, string>;
  /** 数值 */
  value: number;
  /** 时间戳（ms） */
  timestamp?: number;
}

/** 采集器接口 */
export interface MetricCollector {
  /** 采集器名称 */
  name: string;
  /** 指标定义列表 */
  definitions: MetricDefinition[];
  /** 执行采集 */
  collect(): Promise<MetricSample[]>;
}

export interface CollectorDiagnostic {
  collector: string;
  ok: boolean;
  error?: string;
}

export interface MonitoredProviderSnapshot {
  provider: string;
  status: "ok" | "missing" | "error";
  source?: string;
  mode?: string;
  checkedAt: number;
  error?: string;
}

// ─────────────────── Gateway RPC 响应类型（真实结构） ───────────────────

/**
 * health RPC 响应
 * 来源：Gateway `health` method
 */
export interface HealthSnapshot {
  ok: boolean;
  ts?: number;
  durationMs?: number;
  channels?: Record<string, ChannelHealthSummary>;
  channelOrder?: string[];
  channelLabels?: Record<string, string>;
  heartbeatSeconds?: number;
  defaultAgentId?: string;
  agents?: AgentHealthSummary[];
  sessions?: {
    path?: string;
    count?: number;
    recent?: Array<{ key: string; updatedAt: number; age: number }>;
  };
  /** 部分 runtime 可能注入额外字段 */
  uptimeSeconds?: number;
  version?: string;
  pid?: number;
}

/** Channel 健康摘要 */
export interface ChannelHealthSummary {
  linked?: boolean;
  linkStatus?: string;
  accountCount?: number;
  type?: string;
  label?: string;
  [key: string]: unknown;
}

/** Agent 健康摘要 */
export interface AgentHealthSummary {
  id?: string;
  name?: string;
  model?: string;
  workspace?: string;
  [key: string]: unknown;
}

/**
 * channels.status RPC 响应
 */
export interface ChannelsStatusSnapshot {
  ts?: number;
  channelOrder?: string[];
  channelLabels?: Record<string, string>;
  channelDetailLabels?: Record<string, string>;
  channels?: Record<string, ChannelSummary>;
  channelAccounts?: Record<string, ChannelAccount[]>;
  channelDefaultAccountId?: Record<string, string>;
}

/** 单渠道摘要 */
export interface ChannelSummary {
  linked?: boolean;
  linkStatus?: string;
  type?: string;
  [key: string]: unknown;
}

/** 渠道账号 */
export interface ChannelAccount {
  id?: string;
  label?: string;
  [key: string]: unknown;
}

/**
 * sessions.list RPC 响应中的单个会话
 */
export interface SessionEntry {
  sessionId?: string;
  key?: string;
  updatedAt?: number;
  displayName?: string;
  channel?: string;
  subject?: string;
  room?: string;
  space?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextTokens?: number;
  origin?: {
    label?: string;
    provider?: string;
    from?: string;
    to?: string;
    accountId?: string;
    threadId?: string;
  };
  [key: string]: unknown;
}

/**
 * cron.status RPC 响应
 */
export interface CronStatus {
  enabled?: boolean;
  jobCount?: number;
  nextWakeTime?: number;
  [key: string]: unknown;
}

/**
 * 单个 Cron Job
 */
export interface CronJob {
  id?: string;
  schedule?: string;
  agentId?: string;
  enabled?: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  [key: string]: unknown;
}

export interface ModelAuthWindow {
  label?: string;
  usedPercent?: number;
  resetAt?: number;
}

export interface ModelAuthProfile {
  profileId?: string;
  type?: string;
  status?: string;
  expiry?: {
    at?: number;
    remainingMs?: number;
    label?: string;
  };
}

export interface ModelAuthProvider {
  provider?: string;
  displayName?: string;
  status?: string;
  expiry?: {
    at?: number;
    remainingMs?: number;
    label?: string;
  };
  profiles?: ModelAuthProfile[];
  usage?: {
    windows?: ModelAuthWindow[];
    plan?: string;
  };
}

export interface ModelAuthStatusSnapshot {
  ts?: number;
  providers?: ModelAuthProvider[];
}

/**
 * usage.status / usage.cost RPC 响应
 */
export interface UsageData {
  [key: string]: unknown;
}

/**
 * system-presence RPC 响应中的设备
 */
export interface PresenceEntry {
  id?: string;
  clientId?: string;
  platform?: string;
  mode?: string;
  connectedAt?: number;
  [key: string]: unknown;
}
