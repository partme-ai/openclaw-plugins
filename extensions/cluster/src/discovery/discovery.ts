/**
 * 节点发现服务工厂
 *
 * 根据配置的 discovery.type 创建对应的发现服务实例：
 * - static    -- 静态节点列表（开发/测试）
 * - etcd      -- etcd 动态注册与发现（推荐生产环境）
 * - dns-srv   -- DNS SRV 记录发现（K8s 环境）
 * - consul    -- Consul Agent API 注册与发现（HashiCorp 体系）
 * - nacos     -- Nacos Open API（国内 Spring Cloud / Dubbo 常用）
 * - redis     -- Redis SET/LIST + TTL 轮询（轻量）
 * - eureka    -- Netflix Eureka（老版 Spring Cloud）
 * - mdns      -- mDNS/Bonjour 局域网零中心发现
 */

import type { DiscoveryConfig, IDiscoveryService } from "../shared/types.js";
import { StaticDiscovery } from "./static-discovery.js";
import { EtcdDiscovery } from "./etcd-discovery.js";
import { DnsSrvDiscovery } from "./dns-srv-discovery.js";
import { ConsulDiscovery } from "./consul-discovery.js";
import { NacosDiscovery } from "./nacos-discovery.js";
import { RedisDiscovery } from "./redis-discovery.js";
import { EurekaDiscovery } from "./eureka-discovery.js";
import { MdnsDiscovery } from "./mdns-discovery.js";

/**
 * 创建节点发现服务实例
 * 工厂方法，根据配置类型返回对应实现
 *
 * @param config - 发现配置
 * @param nodeId - 当前节点 ID（etcd 需要注册自身）
 * @returns 发现服务实例
 */
export function createDiscoveryService(
  config: DiscoveryConfig,
  nodeId?: string
): IDiscoveryService {
  switch (config.type) {
    case "static":
      return new StaticDiscovery(config.staticNodes ?? []);
    case "etcd":
      return new EtcdDiscovery(config, nodeId ?? `node-${Date.now()}`);
    case "dns-srv":
      return new DnsSrvDiscovery(config);
    case "consul":
      return new ConsulDiscovery(config, nodeId ?? `node-${Date.now()}`);
    case "nacos":
      return new NacosDiscovery(config, nodeId ?? `node-${Date.now()}`);
    case "redis":
      return new RedisDiscovery(config, nodeId ?? `node-${Date.now()}`);
    case "eureka":
      return new EurekaDiscovery(config, nodeId ?? `node-${Date.now()}`);
    case "mdns":
      return new MdnsDiscovery(config, nodeId ?? `node-${Date.now()}`);
    default:
      throw new Error(`Unknown discovery type: ${config.type}`);
  }
}
