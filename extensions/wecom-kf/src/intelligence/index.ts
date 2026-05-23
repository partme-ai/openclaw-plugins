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
