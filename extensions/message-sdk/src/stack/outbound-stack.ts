/**
 * 出站消息栈：按 sessionKey 排队，供传输层 pop 发布。
 */

import type { UnifiedMessage } from "../core/types.js";

export interface OutboundStackItem {
  sessionKey: string;
  message: UnifiedMessage;
  text: string;
  pushedAt: number;
}

/**
 * 按会话分组的出站队列。
 */
export class OutboundMessageStack {
  private readonly bySession = new Map<string, OutboundStackItem[]>();

  push(item: Omit<OutboundStackItem, "pushedAt">): void {
    const list = this.bySession.get(item.sessionKey) ?? [];
    list.push({ ...item, pushedAt: Date.now() });
    this.bySession.set(item.sessionKey, list);
  }

  pop(sessionKey?: string): OutboundStackItem | undefined {
    if (sessionKey) {
      const list = this.bySession.get(sessionKey);
      if (!list?.length) return undefined;
      return list.shift();
    }
    for (const [, list] of this.bySession) {
      if (list.length > 0) {
        return list.shift();
      }
    }
    return undefined;
  }

  peek(sessionKey: string): OutboundStackItem | undefined {
    return this.bySession.get(sessionKey)?.[0];
  }

  clear(sessionKey?: string): void {
    if (sessionKey) {
      this.bySession.delete(sessionKey);
      return;
    }
    this.bySession.clear();
  }
}
