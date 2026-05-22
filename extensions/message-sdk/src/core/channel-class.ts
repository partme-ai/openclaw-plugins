/**
 * 通道类别：Wire（MQ 机器消费者）与 Transcript（IM Control UI 会话）。
 */

/** MQ 类插件：JSON 信封 + dispatchInbound，无 transcript 保证。 */
export const CHANNEL_CLASS_WIRE = "wire" as const;

/** IM 类插件：runAssembled + dispatchReplyWithBufferedBlockDispatcher，保证 Control UI transcript。 */
export const CHANNEL_CLASS_TRANSCRIPT = "transcript" as const;

export type ChannelClass = typeof CHANNEL_CLASS_WIRE | typeof CHANNEL_CLASS_TRANSCRIPT;

/**
 * 判断通道类别是否为 Wire 路径。
 */
export function isWireChannelClass(channelClass: ChannelClass): channelClass is typeof CHANNEL_CLASS_WIRE {
  return channelClass === CHANNEL_CLASS_WIRE;
}

/**
 * 判断通道类别是否为 Transcript 路径。
 */
export function isTranscriptChannelClass(
  channelClass: ChannelClass,
): channelClass is typeof CHANNEL_CLASS_TRANSCRIPT {
  return channelClass === CHANNEL_CLASS_TRANSCRIPT;
}
