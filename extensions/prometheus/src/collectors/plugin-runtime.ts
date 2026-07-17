import type {
  MetricCollector,
  MetricDefinition,
  MetricSample,
} from "../types.js";
import {
  refreshHousekeepingMetrics,
  refreshRuntimeSnapshots,
  refreshSliMetrics,
  refreshHttpLatencyMetrics,
} from "../runtime/observer.js";
import { getRuntimeStore } from "../runtime/store.js";

/**
 * 插件进程内运行态采集器。
 *
 * 与 RPC 采集器不同，它读取 diagnostics/hooks/events 已写入的有界 registry。采集前先刷新
 * snapshot、housekeeping、SLI 和 HTTP 延迟派生值，确保同一 scrape 中定义与样本来自同一
 * RuntimeStore。registry 自身负责系列上限，本层不再复制第二套基数策略。
 */
export class PluginRuntimeCollector implements MetricCollector {
  name = "plugin-runtime";

  /** 动态返回当前 registry 定义；事件订阅可能在两次 scrape 之间增加指标族。 */
  get definitions(): MetricDefinition[] {
    return getRuntimeStore().registry.snapshotDefinitions();
  }

  /** 刷新派生指标后获取不可变样本快照。 */
  async collect(): Promise<MetricSample[]> {
    await refreshRuntimeSnapshots(false);
    refreshHousekeepingMetrics();
    refreshSliMetrics();
    refreshHttpLatencyMetrics();
    return getRuntimeStore().registry.snapshotSamples();
  }
}
