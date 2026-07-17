/**
 * @fileoverview 微信 iPad 入站 Agent 任务的有界串行队列。
 *
 * WebSocket 可以在短时间内推送大量事件，而一次 Agent 调用可能持续数秒。若直接为每个事件
 * 创建异步任务，外部桥接异常或被攻陷时会形成无界 Promise 和模型调用。本队列只保留固定
 * 数量的等待任务，并按接收顺序串行执行，既保护内存，也避免同一微信会话回复乱序。
 */

export type InboundTask = () => Promise<void>;

/**
 * 有界、先进先出的单消费者队列。
 *
 * `enqueue` 只负责接纳任务，不把任务 Promise 暴露给 WebSocket 事件循环；执行失败统一交给
 * `onError`。达到容量或关闭后返回 `false`，调用方必须记录丢弃指标或告警。
 */
export class WechatIpadInboundQueue {
  private readonly pending: InboundTask[] = [];
  private running = false;
  private closed = false;

  constructor(
    private readonly maxPending: number,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** 尝试把任务加入等待队列；正在执行的单个任务不计入 `maxPending`。 */
  enqueue(task: InboundTask): boolean {
    if (this.closed || this.pending.length >= this.maxPending) return false;
    this.pending.push(task);
    this.startDrain();
    return true;
  }

  /** 停止接收新任务并丢弃尚未开始的任务；正在执行的任务允许自然收尾。 */
  close(): void {
    this.closed = true;
    this.pending.length = 0;
  }

  /** 返回不包含消息正文和 wxid 的安全运行快照。 */
  getStatus(): { running: boolean; pending: number; closed: boolean } {
    return { running: this.running, pending: this.pending.length, closed: this.closed };
  }

  private startDrain(): void {
    if (this.running || this.closed) return;
    this.running = true;
    void this.drain();
  }

  /** 单消费者循环保证消息顺序；单个任务失败不会中断后续任务。 */
  private async drain(): Promise<void> {
    try {
      while (!this.closed) {
        const task = this.pending.shift();
        if (!task) break;
        try {
          await task();
        } catch (error) {
          this.onError(error);
        }
      }
    } finally {
      this.running = false;
      // 任务完成与 enqueue 可能发生在同一微任务窗口；再次检查避免遗漏唤醒。
      if (!this.closed && this.pending.length > 0) this.startDrain();
    }
  }
}
