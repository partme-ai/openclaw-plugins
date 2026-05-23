/**
 * @module core/channel-class
 *
 * 通道类别常量：Wire（MQ 机器消费者）与 Transcript（IM Control UI 会话）。
 *
 * **Wire**：JSON 信封 + dispatchInbound，不保证 Control UI transcript。
 * **Transcript**：runAssembled + buffered reply，保证 Control UI 可见 user/agent 轮次。
 *
 * **关键导出**：`CHANNEL_CLASS_WIRE`、`CHANNEL_CLASS_TRANSCRIPT`、类型守卫函数
 */

/** MQ 类插件：JSON 信封 + dispatchInbound，无 transcript 保证 / Wire channel class */
export const CHANNEL_CLASS_WIRE = "wire" as const;

/** IM 类插件：runAssembled + dispatchReplyWithBufferedBlockDispatcher / Transcript channel class */
export const CHANNEL_CLASS_TRANSCRIPT = "transcript" as const;

/** 通道类别联合类型 / Channel class union type */
export type ChannelClass = typeof CHANNEL_CLASS_WIRE | typeof CHANNEL_CLASS_TRANSCRIPT;

/**
 * 判断通道类别是否为 Wire 路径 / Type guard for Wire channel class.
 *
 * @param channelClass - 待判断的通道类别
 */
export function isWireChannelClass(channelClass: ChannelClass): channelClass is typeof CHANNEL_CLASS_WIRE {
  return channelClass === CHANNEL_CLASS_WIRE;
}

/**
 * 判断通道类别是否为 Transcript 路径 / Type guard for Transcript channel class.
 *
 * @param channelClass - 待判断的通道类别
 */
export function isTranscriptChannelClass(
  channelClass: ChannelClass,
): channelClass is typeof CHANNEL_CLASS_TRANSCRIPT {
  return channelClass === CHANNEL_CLASS_TRANSCRIPT;
}
