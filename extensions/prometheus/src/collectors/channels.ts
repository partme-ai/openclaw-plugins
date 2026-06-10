/**
 * Channel 指标采集器
 *
 * 数据来源：Gateway `channels.status` RPC 方法
 * 返回所有渠道的连接状态、账号信息、标签等。
 *
 * 从真实数据中提取：
 * - 渠道总数、已链接数
 * - 每渠道的链接状态和类型
 * - 每渠道的账号数
 */

import type {
  MetricCollector, MetricDefinition, MetricSample,
  ChannelsStatusSnapshot,
} from "../types.js";
import { rpcCall } from "../runtime/ws-bridge.js";

const PREFIX = "openclaw_channel";
const CHANNELS_STATUS_PARAMS = {
  probe: false,
  timeoutMs: 8000,
} as const;

/**
 * Channel 采集器
 * 调用 Gateway `channels.status` RPC
 */
export class ChannelCollector implements MetricCollector {
  name = "channels";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_total`, help: "Total configured channels", type: "gauge" },
    { name: `${PREFIX}_linked_total`, help: "Channels in linked state", type: "gauge" },
    { name: `${PREFIX}_unlinked_total`, help: "Channels in unlinked state", type: "gauge" },

    // 按渠道
    { name: `${PREFIX}_linked`, help: "Channel link status (1=linked, 0=unlinked)", type: "gauge", labels: ["channel_id", "channel_type", "channel_label"] },
    { name: `${PREFIX}_accounts`, help: "Number of accounts per channel", type: "gauge", labels: ["channel_id"] },
  ];

  /**
   * 采集 Channel 指标
   * 从 channels.status 真实响应中解析
   */
  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];
    const snapshot = await rpcCall<ChannelsStatusSnapshot>("channels.status", CHANNELS_STATUS_PARAMS);

    const channels = snapshot.channels ?? {};
    const labels = snapshot.channelLabels ?? {};
    const accounts = snapshot.channelAccounts ?? {};

    const channelIds = Object.keys(channels);
    let linkedCount = 0;

    samples.push({ name: `${PREFIX}_total`, value: channelIds.length });

    for (const id of channelIds) {
      const ch = channels[id];
      const linked = ch.linked ? 1 : 0;
      if (linked) linkedCount++;

      samples.push({
        name: `${PREFIX}_linked`,
        labels: {
          channel_id: id,
          channel_type: ch.type ?? "unknown",
          channel_label: labels[id] ?? id,
        },
        value: linked,
      });

      // 账号数
      const accts = accounts[id];
      samples.push({
        name: `${PREFIX}_accounts`,
        labels: { channel_id: id },
        value: Array.isArray(accts) ? accts.length : 0,
      });
    }

    samples.push({ name: `${PREFIX}_linked_total`, value: linkedCount });
    samples.push({ name: `${PREFIX}_unlinked_total`, value: channelIds.length - linkedCount });

    return samples;
  }
}
