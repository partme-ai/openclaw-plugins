/**
 * 概率采样器
 * 基于 traceId hash 的确定性采样
 *
 * 特性：
 * - 相同 traceId 始终产生相同采样结果（确定性）
 * - 采样率 0.0 ~ 1.0
 * - 基于 FNV-1a hash 算法
 * - 支持动态调整采样率
 */

/**
 * 追踪采样器
 * 基于 traceId 的确定性概率采样
 */
export class TracingSampler {
  /** 当前采样率（0.0 ~ 1.0） */
  private sampleRate: number;

  /**
   * @param sampleRate - 采样率，默认 1.0（100% 采样）
   */
  constructor(sampleRate: number = 1.0) {
    this.sampleRate = Math.max(0, Math.min(1, sampleRate));
  }

  /**
   * 判断给定 traceId 是否应该被采样
   * 使用 FNV-1a hash 确保确定性：相同 traceId 始终返回相同结果
   *
   * @param traceId - 16 字节十六进制 trace ID
   * @returns 是否采样
   */
  shouldSample(traceId: string): boolean {
    // 全采样 / 全不采样 — 快速路径
    if (this.sampleRate >= 1.0) return true;
    if (this.sampleRate <= 0.0) return false;

    // 基于 traceId hash 的确定性采样
    const hash = fnv1aHash(traceId);
    const threshold = Math.floor(this.sampleRate * 0xFFFFFFFF);
    return (hash >>> 0) < threshold;
  }

  /**
   * 获取当前采样率
   */
  getSampleRate(): number {
    return this.sampleRate;
  }

  /**
   * 动态调整采样率
   *
   * @param rate - 新采样率（0.0 ~ 1.0）
   */
  setSampleRate(rate: number): void {
    this.sampleRate = Math.max(0, Math.min(1, rate));
    console.log(`[openclaw-tracing] Sample rate updated to ${this.sampleRate}`);
  }
}

/**
 * FNV-1a 32-bit Hash 算法
 * 快速、分布均匀，适合采样场景
 *
 * @param input - 输入字符串
 * @returns 32-bit hash 值
 */
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash;
}
