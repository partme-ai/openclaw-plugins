export type MemoryLevel = "L0" | "L1" | "L2" | "L3";

export type NormalizedMessage = {
  role: string;
  content: string;
};

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

