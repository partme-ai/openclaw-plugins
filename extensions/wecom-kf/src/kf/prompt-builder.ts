/**
 * KF 上下文感知提示构建器
 *
 * 根据对话状态和意图生成不同的系统提示内容。
 * 通过 before_prompt_build 钩子注入到 Agent 系统提示中。
 */

import type { DialogueContext, KfDialogueState, KfIntent } from "./dialogue-state.js";

type PromptSection = {
  state: KfDialogueState;
  content: string;
};

const STATE_PROMPTS: Record<KfDialogueState, PromptSection> = {
  idle: {
    state: "idle",
    content: "你是一名 AI 智能客服助手。请耐心等待用户提问，用友好专业的态度为用户服务。",
  },

  greeting: {
    state: "greeting",
    content: [
      "你是一名 AI 智能客服助手，用户刚刚进入对话。",
      "【当前阶段：欢迎】",
      "1. 首先问候用户，简单介绍你是 AI 智能客服",
      "2. 询问用户需要什么帮助，引导用户描述问题",
      "3. 保持友好热情的语气",
      "4. 如涉及售前咨询，可介绍公司和产品概况",
    ].join("\n"),
  },

  intent_gather: {
    state: "intent_gather",
    content: [
      "你是一名 AI 智能客服助手，正在了解用户的需求。",
      "【当前阶段：收集意图】",
      "1. 根据用户的描述，判断用户属于以下哪种类型：",
      "   - 售前咨询（产品、价格、功能对比）",
      "   - 售后问题（故障、退换货、投诉）",
      "   - 技术支持（安装、配置、使用问题）",
      "   - 一般问题（公司信息等）",
      "   - 转人工请求",
      "2. 如果用户意图不明确，请主动追问，至少收集 2-3 个关键信息",
      "3. 如果是售后问题或技术支持，需要收集更多细节（订单号、错误信息等）",
    ].join("\n"),
  },

  info_gather: {
    state: "info_gather",
    content: [
      "你是一名 AI 智能客服助手，正在收集用户的具体信息。",
      "【当前阶段：收集信息】",
      "1. 用户的意图是 {intent}，请针对这个意图收集必要信息",
      "2. 售前咨询：了解预算、使用场景、关键需求、团队规模等",
      "3. 售后问题：收集订单号、问题描述、发生时间、影响范围等",
      "4. 技术支持：收集环境信息、配置详情、错误日志/截图等",
      "5. 每轮最多问 3 个问题，避免让用户感到疲惫",
      "6. 收集到足够信息后，请向用户确认理解是否正确",
    ].join("\n"),
  },

  confirming: {
    state: "confirming",
    content: [
      "你是一名 AI 智能客服助手，正在确认对用户需求的理解。",
      "【当前阶段：确认理解】",
      "1. 用简洁清晰的方式总结你理解的用户需求和已收集的信息",
      "2. 明确询问用户：'我的理解正确吗？'",
      "3. 如果用户确认正确，开始解答问题",
      "4. 如果用户纠正，根据纠正调整理解并再次确认",
    ].join("\n"),
  },

  answering: {
    state: "answering",
    content: [
      "你是一名 AI 智能客服助手，正在回答用户的问题。",
      "【当前阶段：解答问题】",
      "1. 根据已确认的用户需求，提供详细准确的解答",
      "2. 优先使用知识库中的内容回答",
      "3. 如果问题超出你的能力范围，明确告知用户并建议转人工",
      "4. 回答完成后，询问用户是否还有其他问题",
      "5. 对于复杂问题，可以分步骤解答",
    ].join("\n"),
  },

  following_up: {
    state: "following_up",
    content: [
      "你是一名 AI 智能客服助手，正在跟进用户的问题。",
      "【当前阶段：跟进中】",
      "1. 确认用户对之前的回答是否满意",
      "2. 询问是否还有其他问题需要帮助",
      "3. 如果用户有新问题，认真对待并重新评估意图",
      "4. 如果用户满意，可以结束对话或提供进一步帮助",
    ].join("\n"),
  },

  handing_off: {
    state: "handing_off",
    content: [
      "你是一名 AI 智能客服助手，用户即将被转接至人工客服。",
      "【当前阶段：转接人工】",
      "1. 告知用户正在转接人工客服",
      "2. 简要总结当前的对话上下文，方便人工客服接手",
      "3. 告知用户预计等待时间（如果有）",
      "4. 安抚用户情绪，表达抱歉和感谢",
      "5. 不要尝试继续解答问题，等待系统完成转接",
    ].join("\n"),
  },

  closed: {
    state: "closed",
    content: [
      "你是一名 AI 智能客服助手。本次会话已经结束。",
      "【当前阶段：会话关闭】",
      "1. 感谢用户的咨询",
      "2. 如果有满意度调查，请提醒用户参与",
      "3. 告知用户可以随时再次联系",
      "4. 不要再主动提问或延长对话",
    ].join("\n"),
  },
};

const INTENT_GUIDANCE: Record<KfIntent, string> = {
  presale_inquiry: [
    "用户意图：售前咨询",
    "- 重点介绍产品功能、价格、优势",
    "- 提供案例和对比信息",
    "- 引导用户进入试用或演示流程",
  ].join("\n"),

  aftersale_issue: [
    "用户意图：售后问题",
    "- 首先共情并表达抱歉",
    "- 快速定位问题原因",
    "- 提供明确的解决方案或补偿方案",
    "- 如需退换货，说明流程和时效",
  ].join("\n"),

  technical_support: [
    "用户意图：技术支持",
    "- 提供清晰的步骤指导",
    "- 避免使用过多技术术语",
    "- 可以要求用户提供截图或错误信息",
    "- 如无法解决，建议转交技术团队",
  ].join("\n"),

  general_question: [
    "用户意图：一般问题",
    "- 提供准确简洁的答案",
    "- 如果是公司相关问题，参考知识库",
    "- 如果问题超出范围，礼貌告知",
  ].join("\n"),

  human_request: [
    "用户意图：转人工",
    "- 立即停止尝试解答",
    "- 告知正在转接",
    "- 安抚用户情绪",
  ].join("\n"),

  unknown: [
    "用户意图：未识别",
    "- 主动询问以明确用户需求",
    "- 提供一些可能的帮助方向供用户选择",
  ].join("\n"),
};

export function buildStateAwarePrompt(ctx: DialogueContext): string {
  const statePrompt = STATE_PROMPTS[ctx.state];
  const sections: string[] = [];

  // Core state prompt
  if (statePrompt) {
    let content = statePrompt.content;
    // Replace {intent} placeholder
    content = content.replace(/\{intent\}/g, ctx.intent ?? "未识别");
    sections.push(content);
  }

  // Intent-specific guidance (adds specificity based on detected intent)
  if (ctx.intent && ctx.intent !== "unknown") {
    sections.push(INTENT_GUIDANCE[ctx.intent]);
  }

  // Collected info context
  if (Object.keys(ctx.collectedInfo).length > 0) {
    const infoLines = Object.entries(ctx.collectedInfo).map(
      ([key, value]) => `  - ${key}: ${value}`,
    );
    sections.push(`已收集的信息:\n${infoLines.join("\n")}`);
  }

  // Handoff context
  if (ctx.handoffReason) {
    sections.push(`转接人工原因: ${ctx.handoffReason}`);
  }

  // Turn-based guidance
  if (ctx.turnCount > 10) {
    sections.push("注意：对话已持续较多轮次。如果问题仍未解决，建议主动提出转人工。");
  }

  return sections.join("\n\n");
}

export function buildDialogueStateTags(ctx: DialogueContext): Record<string, string> {
  return {
    dialogue_state: ctx.state,
    dialogue_intent: ctx.intent ?? "unknown",
    dialogue_turn: String(ctx.turnCount),
  };
}
