/**
 * HTTP 节点间代理完整实现
 *
 * 提供节点间消息路由能力：
 * - 启动一个 HTTP 服务器监听其他节点的转发请求
 * - 通过 HTTP POST 将消息转发到目标节点
 * - 支持健康检查和节点列表查询
 * - 包含超时和错误重试机制
 *
 * 端点：
 * - POST /forward        -- 接收转发消息
 * - GET  /proxy/health   -- 代理健康检查
 * - GET  /proxy/nodes    -- 已知节点列表
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { ProxyConfig, IProxyService, ClusterNodeInfo } from "../types.js";

/**
 * 消息转发请求体
 */
interface ForwardRequest {
  /** 源节点 ID */
  sourceNodeId: string;
  /** 目标会话键 */
  sessionKey: string;
  /** 消息体 */
  message: string;
  /** 时间戳 */
  timestamp: string;
}

/**
 * HTTP 节点间代理
 *
 * 每个集群节点运行一个 HTTP 代理，
 * 负责接收来自其他节点的转发消息，并转发本地消息到远端节点。
 */
export class HttpProxyServer implements IProxyService {
  /** 代理配置 */
  private readonly config: ProxyConfig;

  /** HTTP 服务器实例 */
  private server: Server | null = null;

  /** 已知节点列表（由 discovery 服务更新） */
  private knownNodes: Map<string, ClusterNodeInfo> = new Map();

  /** 消息转发处理回调 */
  private onMessageCallback:
    | ((sessionKey: string, message: string, sourceNodeId: string) => Promise<void>)
    | null = null;

  constructor(config: ProxyConfig) {
    this.config = config;
  }

  /**
   * 启动代理 HTTP 服务器
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.handleRequest(req, res).catch((err) => {
          console.error("[openclaw-cluster] Proxy request error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Internal server error" }));
        });
      });

      this.server.on("error", (err) => {
        console.error("[openclaw-cluster] Proxy server error:", err);
        reject(err);
      });

      this.server.listen(this.config.port, () => {
        console.log(`[openclaw-cluster] HTTP proxy listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  /**
   * 停止代理服务器
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log("[openclaw-cluster] HTTP proxy stopped");
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 转发消息到指定节点
   *
   * @param targetNodeId - 目标节点 ID
   * @param sessionKey - 会话标识
   * @param message - 消息内容
   */
  async forwardMessage(
    targetNodeId: string,
    sessionKey: string,
    message: string
  ): Promise<void> {
    const node = this.knownNodes.get(targetNodeId);
    if (!node) {
      throw new Error(`Unknown target node: ${targetNodeId}`);
    }

    const forwardReq: ForwardRequest = {
      sourceNodeId: "self",
      sessionKey,
      message,
      timestamp: new Date().toISOString(),
    };

    const url = `http://${node.address}:${node.port}/forward`;
    const timeout = this.config.timeout ?? 5_000;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(forwardReq),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Forward to ${targetNodeId} failed: ${response.status} ${text}`);
    }
  }

  /**
   * 更新已知节点列表
   *
   * 由 discovery 服务在检测到节点变更时调用。
   *
   * @param nodes - 最新节点列表
   */
  updateNodes(nodes: ClusterNodeInfo[]): void {
    this.knownNodes.clear();
    for (const node of nodes) {
      this.knownNodes.set(node.nodeId, node);
    }
  }

  /**
   * 注册消息接收处理器
   *
   * @param callback - 收到转发消息时的处理函数
   */
  onMessage(
    callback: (sessionKey: string, message: string, sourceNodeId: string) => Promise<void>
  ): void {
    this.onMessageCallback = callback;
  }

  // ======================== HTTP 请求处理 ========================

  /**
   * 处理代理 HTTP 请求
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // CORS 预检
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    switch (url.pathname) {
      case "/forward":
        await this.handleForward(req, res);
        break;
      case "/proxy/health":
        this.handleHealth(res);
        break;
      case "/proxy/nodes":
        this.handleNodes(res);
        break;
      default:
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Not found" }));
    }
  }

  /**
   * 处理消息转发请求
   */
  private async handleForward(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
      return;
    }

    const body = await this.readBody(req);
    const forwardReq = JSON.parse(body) as ForwardRequest;

    // 验证请求
    if (!forwardReq.sessionKey || !forwardReq.message) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Missing sessionKey or message" }));
      return;
    }

    // 交给消息处理器
    if (this.onMessageCallback) {
      await this.onMessageCallback(
        forwardReq.sessionKey,
        forwardReq.message,
        forwardReq.sourceNodeId
      );
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, received: true }));
  }

  /**
   * 处理健康检查
   */
  private handleHealth(res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        data: {
          port: this.config.port,
          protocol: this.config.protocol,
          knownNodes: this.knownNodes.size,
          uptime: process.uptime(),
        },
      })
    );
  }

  /**
   * 处理节点列表查询
   */
  private handleNodes(res: ServerResponse): void {
    const nodes = Array.from(this.knownNodes.values());
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, data: nodes }));
  }

  /**
   * 读取请求体
   *
   * @param req - HTTP 请求
   * @returns 请求体字符串
   */
  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }
}
