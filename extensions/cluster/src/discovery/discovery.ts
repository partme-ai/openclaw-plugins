/**
 * @fileoverview **节点发现聚合工厂**：将 `DiscoveryConfig.type` **映射到具体 `IDiscoveryService` 实现**。
 *
 * @description OpenClaw 宿主只需 `import { createDiscoveryService }` 即可在 **static / etcd / dns-srv /
 * consul / nacos / redis / eureka / mdns** 间切换，而无需触碰各适配器 ctor 细节。
 *
 * **与本文件相关的集群角色**
 * - 负责维护 **成员集合（membership）** 与（尽力而为的）**负载字段**；
 * - 拓扑变化应通过 `onNodeChange` 下传到 `proxy`，以刷新转发路由表。
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
 * @description 运行时工厂：构造 `IDiscoveryService`。
 *
 * @param config - `cluster.discovery` 段落。
 * @param nodeId - **当前副本 ID**；在需要自注册的模式（etcd/Consul/...）下必填；省略时将使用时间戳兜底——仅适合单机试验。
 * @returns 已绑定配置的具体实现实例（尚未 `await start()`）。
 * @throws {Error} `config.type` 字面量不匹配 TS union 残余值（配置篡改或前后版本漂移）。
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
