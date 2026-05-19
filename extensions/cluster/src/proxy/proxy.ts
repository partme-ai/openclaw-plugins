/**
 * 节点间代理服务工厂
 *
 * 根据配置协议创建对应的代理实现：
 * - http -- HTTP 代理（默认，通用性好）
 * - grpc -- gRPC 代理（高性能，待实现）
 */

import type { ProxyConfig, IProxyService } from "../types.js";
import { HttpProxyServer } from "./http-proxy.js";
import { GrpcProxyServer } from "./grpc-proxy.js";

/**
 * 创建代理服务实例
 * 工厂方法，根据配置协议返回对应实现
 *
 * @param config - 代理配置
 * @returns 代理服务实例
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
