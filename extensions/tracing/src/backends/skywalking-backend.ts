/**
 * SkyWalking 后端
 * 通过 skywalking-backend-js 导出 Span 到 Apache SkyWalking APM 系统
 *
 * 特性：
 * - 零配置接入（使用环境变量或默认配置）
 * - 自动服务注册
 * - 完整的链路追踪
 * - 内置多种库自动 instrumentation
 */

import type { TracingBackend, TracingConfig, Span } from "../types.js";

/** 默认 SkyWalking Collector 地址 */
const DEFAULT_COLLECTOR_ADDRESS = "127.0.0.1:11800";

/** 默认服务名称 */
const DEFAULT_SERVICE_NAME = "openclaw-gateway";

/** 缓冲区大小 */
const BUFFER_SIZE = 1000;

type SkyWalkingAgent = {
  start(options?: {
    serviceName?: string;
    serviceInstance?: string;
    collectorAddress?: string;
  }): void;
  flush(): Promise<unknown> | null;
};

/**
 * SkyWalking 追踪后端
 * 通过 skywalking-backend-js 库与 SkyWalking OAP 服务器通信
 */
export class SkyWalkingBackend implements TracingBackend {
  name = "skywalking";
  
  /** SkyWalking 配置 */
  private serviceName: string = DEFAULT_SERVICE_NAME;
  private serviceInstance: string = "openclaw-instance";
  private collectorAddress: string = DEFAULT_COLLECTOR_ADDRESS;
  
  /** 缓冲区 */
  private buffer: Span[] = [];
  
  /** 缓冲区刷新定时器 */
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  
  /** SkyWalking agent 引用 */
  private agent: SkyWalkingAgent | null = null;
  
  /**
   * 初始化 SkyWalking 后端
   */
  async init(config: TracingConfig): Promise<void> {
    this.serviceName = config.skywalkingServiceName || DEFAULT_SERVICE_NAME;
    this.serviceInstance = config.skywalkingServiceInstance || `${this.serviceName}-instance`;
    this.collectorAddress = config.skywalkingCollectorAddress || DEFAULT_COLLECTOR_ADDRESS;
    
    try {
      const skywalking = await import("skywalking-backend-js");
      const agent = (skywalking as unknown as { default: SkyWalkingAgent }).default;
      this.agent = agent;
      
      agent.start({
        serviceName: this.serviceName,
        serviceInstance: this.serviceInstance,
        collectorAddress: this.collectorAddress,
      });
      
      console.log(`[openclaw-tracing] SkyWalking backend initialized: ${this.collectorAddress}`);
      console.log(`[openclaw-tracing] Service: ${this.serviceName}, Instance: ${this.serviceInstance}`);
      
      this.startFlushTimer();
    } catch (error) {
      console.error("[openclaw-tracing] Failed to initialize SkyWalking agent:", error);
      throw error;
    }
  }
  
  /**
   * 启动缓冲区刷新定时器
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushBuffer().catch((err) => {
        console.error("[openclaw-tracing] SkyWalking flush error:", err);
      });
    }, 10000);
  }
  
  /**
   * 导出 Span 到 SkyWalking
   * 
   * @param spans - 待导出的 Span 列表
   */
  async exportSpans(spans: Span[]): Promise<void> {
    if (!this.agent) {
      console.warn("[openclaw-tracing] SkyWalking agent not initialized");
      return;
    }
    
    for (const span of spans) {
      this.buffer.push(span);
    }
    
    if (this.buffer.length >= BUFFER_SIZE) {
      await this.flushBuffer();
    }
  }
  
  /**
   * 刷新缓冲区
   * 将缓冲区中的 Span 转换为 SkyWalking 格式并发送
   */
  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0 || !this.agent) {
      return;
    }
    
    this.buffer.splice(0);
    await this.agent.flush();
  }
  
  /**
   * 关闭后端
   * 停止定时器并刷新剩余数据
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    
    await this.flushBuffer();
    
    console.log("[openclaw-tracing] SkyWalking backend shutdown");
  }
}
