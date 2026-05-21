/**
 * 静态节点发现单元测试
 *
 * 测试覆盖：
 * - 节点列表初始化
 * - 地址解析（含端口和不含端口）
 * - 启动和停止生命周期
 * - 节点变更回调注册
 */

import { describe, it, expect, beforeEach } from "vitest";
import { StaticDiscovery } from "./static-discovery.js";

describe("StaticDiscovery", () => {
  let discovery: StaticDiscovery;

  beforeEach(() => {
    discovery = new StaticDiscovery([
      "192.168.1.1:18789",
      "192.168.1.2:18790",
      "192.168.1.3",
    ]);
  });

  it("启动后应返回配置的节点列表", async () => {
    await discovery.start();
    const nodes = discovery.getNodes();
    expect(nodes).toHaveLength(3);
  });

  it("应正确解析带端口的地址", async () => {
    await discovery.start();
    const nodes = discovery.getNodes();
    expect(nodes[0].address).toBe("192.168.1.1");
    expect(nodes[0].port).toBe(18789);
    expect(nodes[1].port).toBe(18790);
  });

  it("应为无端口地址使用默认端口 18789", async () => {
    await discovery.start();
    const nodes = discovery.getNodes();
    expect(nodes[2].port).toBe(18789);
  });

  it("所有节点状态应为 online", async () => {
    await discovery.start();
    const nodes = discovery.getNodes();
    expect(nodes.every((n) => n.status === "online")).toBe(true);
  });

  it("停止后应清空节点列表", async () => {
    await discovery.start();
    expect(discovery.getNodes()).toHaveLength(3);

    await discovery.stop();
    expect(discovery.getNodes()).toHaveLength(0);
  });

  it("应支持注册节点变更回调", async () => {
    const callback = () => {};
    discovery.onNodeChange(callback);
    // 不抛出异常即可
    await discovery.start();
  });

  it("getNodes 应返回副本而非引用", async () => {
    await discovery.start();
    const nodes1 = discovery.getNodes();
    const nodes2 = discovery.getNodes();
    expect(nodes1).not.toBe(nodes2);
    expect(nodes1).toEqual(nodes2);
  });

  it("空节点列表应正常工作", async () => {
    const emptyDiscovery = new StaticDiscovery([]);
    await emptyDiscovery.start();
    expect(emptyDiscovery.getNodes()).toHaveLength(0);
  });
});
