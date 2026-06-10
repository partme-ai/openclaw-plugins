/**
 * KF 对话状态机
 *
 * 管理客户服务对话的多轮状态转换，用于改进上下文感知的问答质量。
 * 状态通过 OpenClaw session extension 持久化。
 */

export type KfDialogueState =
  | "idle"           // 空闲 / 等待用户输入
  | "greeting"       // 欢迎阶段
  | "intent_gather"  // 收集意图
  | "info_gather"    // 收集信息 (工单详情、联系方式等)
  | "confirming"     // 确认理解
  | "answering"      // 正在回答
  | "following_up"   // 跟进中
  | "handing_off"    // 转接人工
  | "closed";        // 会话结束

export type KfIntent =
  | "presale_inquiry"    // 售前咨询: 产品、价格、功能对比
  | "aftersale_issue"    // 售后问题: 故障、退换货、投诉
  | "technical_support"  // 技术支持: 安装、配置、调试
  | "general_question"   // 一般问题: 公司信息、工作时间等
  | "human_request"      // 明确要求转人工
  | "unknown";           // 无法分类

export type DialogueContext = {
  state: KfDialogueState;
  sessionId: string;
  userId: string;
  intent?: KfIntent;
  intentConfidence?: number;
  collectedInfo: Record<string, string>;
  handoffReason?: string;
  turnCount: number;
  createdAt: number;
  updatedAt: number;
};

export const DIALOGUE_SESSION_NAMESPACE = "wecom-kf-dialogue";

export function createDialogueContext(params: {
  sessionId: string;
  userId: string;
}): DialogueContext {
  return {
    state: "idle",
    sessionId: params.sessionId,
    userId: params.userId,
    collectedInfo: {},
    turnCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function updateDialogueContext(
  ctx: DialogueContext,
  patch: Partial<Omit<DialogueContext, "sessionId" | "userId" | "createdAt">>,
): DialogueContext {
  return {
    ...ctx,
    ...patch,
    turnCount: (ctx.turnCount ?? 0) + 1,
    updatedAt: Date.now(),
  };
}
