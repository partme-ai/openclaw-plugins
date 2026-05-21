/**
 * openclaw-tracing 类型定义
 *
 * 定义分布式追踪所需的核心数据结构，
 * 兼容 OpenTelemetry Span 模型。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** OpenClaw 插件 API */
export interface PluginApi {
  runtime: GatewayRuntime;
  registerHttpRoute(route: {
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
  }): void;
}

/** Gateway 运行时 */
export interface GatewayRuntime {
  config: Record<string, unknown>;
  gatewayCall?: (method: string, params?: unknown) => Promise<unknown>;
}

/** 追踪配置 */
export interface TracingConfig {
  enabled: boolean;
  backend: "log" | "file" | "otlp" | "skywalking";
  otlpEndpoint: string;
  sampleRate: number;
  traceDir: string;
  maxSpansPerTrace: number;
  captureMessageBody: boolean;
  /** SkyWalking 服务名称 */
  skywalkingServiceName?: string;
  /** SkyWalking 服务实例名称 */
  skywalkingServiceInstance?: string;
  /** SkyWalking collector 地址 */
  skywalkingCollectorAddress?: string;
}

/**
 * 单个 Span 表示一次操作
 *
 * 遵循 OpenTelemetry Span 规范，包含时间戳、属性和状态码。
 */
export interface Span {
  /** 16 字节十六进制 trace ID */
  traceId: string;
  /** 8 字节十六进制 span ID */
  spanId: string;
  /** 父 span ID（根 span 为空） */
  parentSpanId?: string;
  /** 操作名称 */
  name: string;
  /** Span 类型 */
  kind: SpanKind;
  /** 开始时间（毫秒时间戳） */
  startTimeMs: number;
  /** 结束时间（毫秒时间戳） */
  endTimeMs?: number;
  /** Span 属性键值对 */
  attributes: Record<string, string | number | boolean>;
  /** 状态码 */
  status: SpanStatus;
  /** 事件列表（日志点） */
  events: SpanEvent[];
}

/** Span 类型 */
export type SpanKind = "internal" | "server" | "client" | "producer" | "consumer";

/** Span 状态 */
export type SpanStatus = "unset" | "ok" | "error";

/** Span 内的事件 */
export interface SpanEvent {
  name: string;
  timestampMs: number;
  attributes?: Record<string, string | number | boolean>;
}

/**
 * 一组完整追踪
 *
 * 包含一个 trace 下的所有 Span，通常代表一次完整的消息流转。
 */
export interface Trace {
  traceId: string;
  spans: Span[];
  startTimeMs: number;
  endTimeMs?: number;
}

/**
 * 追踪后端接口
 *
 * 不同的追踪后端（Log、File、OTLP）需实现此接口。
 */
export interface TracingBackend {
  /** 后端名称 */
  name: string;
  /** 初始化后端 */
  init(config: TracingConfig): Promise<void>;
  /** 导出一批 Span */
  exportSpans(spans: Span[]): Promise<void>;
  /** 关闭后端，刷新缓冲 */
  shutdown(): Promise<void>;
}
