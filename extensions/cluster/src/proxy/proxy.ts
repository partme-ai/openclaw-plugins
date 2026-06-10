/**
 * @fileoverview **节点间消息平面工厂**：选择 HTTP 或 gRPC（及其实验性降级路径）实现 `IProxyService`。
 *
 * @description `HttpProxyServer` 为当前完整功能实现；`GrpcProxyServer` 通过动态 `require` 探测可选依赖。
 */


import type { ProxyConfig, IProxyService } from "../shared/types.js";
import { HttpProxyServer } from "./http-proxy.js";
import { GrpcProxyServer } from "./grpc-proxy.js";

/**
 * @description 根据 `ProxyConfig.protocol` 构造节点间消息转发服务实例。
 *
 * @param config - `cluster.proxy` 配置段落。
 * @returns 对应协议的 `IProxyService` 实现（尚未 `start()`）。
 * @throws {Error} 协议字面量不在 `http` | `grpc` 范围内。
 */
export function createProxyService(config: ProxyConfig): IProxyService {
  switch (config.protocol) {
    case "http":
      return new HttpProxyServer(config);
    case "grpc":
      return new GrpcProxyServer(config);
    default:
      throw new Error(`Unknown proxy protocol: ${config.protocol}`);
  }
}
