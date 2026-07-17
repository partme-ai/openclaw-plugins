/**
 * Memory 的持久化领域模型。
 *
 * `CapturedTurn` 保存原始当前轮，`MemoryRecord` 保存 L0-L3 可检索记录；所有记录都
 * 携带 agentId/sessionKey，使存储层能够物理分区而不是只依赖查询时过滤。
 */
export type MemoryLevel = "L0" | "L1" | "L2" | "L3";

/** 从宿主消息内容中提取出的最小角色/纯文本结构。 */
export type NormalizedMessage = {
  role: string;
  content: string;
};

/**
 * L1-L3 检索记录：L1 保存事件，L2 保存场景摘要，L3 保存明确的用户画像事实。
 * `sessionKey` 始终落盘用于审计；是否跨会话召回由存储层 `profileScope` 决定。
 */
export type MemoryRecord = {
  id: string;
  level: MemoryLevel;
  type: "conversation" | "episodic" | "scenario" | "profile";
  content: string;
  keywords: string[];
  agentId: string;
  sessionKey: string;
  senderId?: string;
  runId?: string;
  createdAt: string;
};

/**
 * L0 当前轮原始录制。
 * `runId` 用作幂等依据，同一 Agent Turn 重复触发 `agent_end` 时不会追加第二份记录。
 */
export type CapturedTurn = {
  id: string;
  level: "L0";
  type: "conversation";
  agentId: string;
  sessionKey: string;
  senderId?: string;
  runId?: string;
  messages: NormalizedMessage[];
  createdAt: string;
};
