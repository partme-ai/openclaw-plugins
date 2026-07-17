/**
 * @fileoverview 企业微信客服对话智能层的统一公共出口。
 *
 * 聚合意图识别、对话状态机、状态感知 Prompt、Session 持久化和 Hook 注册，使 Channel 层
 * 只依赖一个稳定入口，不直接耦合各个 intelligence 子模块。
 */
export {
  type KfDialogueState,
  type KfIntent,
  type DialogueContext,
  DIALOGUE_SESSION_NAMESPACE,
  createDialogueContext,
  updateDialogueContext,
} from "./dialogue-state.js";

export {
  type DialogueEvent,
  transitionState,
} from "./dialogue-transitions.js";

export {
  type IntentResult,
  classifyIntent,
  isHumanTransferRequest,
  isGreeting,
} from "./intent-classifier.js";

export {
  buildStateAwarePrompt,
  buildDialogueStateTags,
} from "./prompt-builder.js";

export {
  registerDialogueSessionExtension,
  loadDialogueContext,
  persistDialogueContext,
  applyInboundDialogueTransition,
  applyOutboundDialogueTransition,
} from "./dialogue-session.js";

export { registerIntelligenceHooks } from "./hooks.js";
