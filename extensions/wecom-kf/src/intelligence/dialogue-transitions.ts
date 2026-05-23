/**
 * KF 对话状态转换逻辑
 *
 * 根据当前状态和触发事件确定下一个状态。
 * 每个转换函数返回新的 DialogueContext（不可变模式）。
 */

import {
  type DialogueContext,
  type KfDialogueState,
  type KfIntent,
  updateDialogueContext,
} from "./dialogue-state.js";
import { classifyIntent } from "./intent-classifier.js";

export type DialogueEvent =
  | { type: "user_message"; text: string }
  | { type: "agent_response"; text: string }
  | { type: "info_collected"; fields: Record<string, string> }
  | { type: "handoff_request"; reason: string }
  | { type: "session_timeout" }
  | { type: "session_close" }
  | { type: "intent_detected"; intent: KfIntent; confidence?: number };

export function transitionState(
  current: DialogueContext,
  event: DialogueEvent,
): DialogueContext {
  switch (event.type) {
    case "user_message":
      return handleUserMessage(current, event);
    case "agent_response":
      return handleAgentResponse(current);
    case "info_collected":
      return handleInfoCollected(current, event);
    case "handoff_request":
      return handleHandoffRequest(current, event);
    case "session_timeout":
      return handleSessionTimeout(current);
    case "session_close":
      return handleSessionClose(current);
    case "intent_detected":
      return handleIntentDetected(current, event);
    default:
      return current;
  }
}

function handleUserMessage(
  current: DialogueContext,
  event: { type: "user_message"; text: string },
): DialogueContext {
  const { state } = current;

  // Classify intent from message text
  const intentResult = classifyIntent(event.text);

  switch (state) {
    case "idle":
      return updateDialogueContext(current, {
        state: "greeting",
        intent: intentResult.intent,
        intentConfidence: intentResult.confidence,
      });

    case "greeting":
      // After greeting, move to intent gathering
      if (intentResult.intent === "human_request") {
        return updateDialogueContext(current, {
          state: "handing_off",
          intent: intentResult.intent,
          handoffReason: "user requested human agent in greeting phase",
        });
      }
      return updateDialogueContext(current, {
        state: "intent_gather",
        intent: intentResult.intent,
        intentConfidence: intentResult.confidence,
      });

    case "intent_gather":
      // If low confidence, stay in intent_gather; otherwise move to answering or info_gather
      if (intentResult.confidence < 0.5) {
        return updateDialogueContext(current, {
          intent: intentResult.intent,
          intentConfidence: intentResult.confidence,
        });
      }
      return updateDialogueContext(current, {
        state: shouldGatherInfo(intentResult.intent) ? "info_gather" : "answering",
        intent: intentResult.intent,
        intentConfidence: intentResult.confidence,
      });

    case "info_gather":
      // After receiving info from user, move to confirming
      return updateDialogueContext(current, {
        state: "confirming",
      });

    case "confirming":
      // After user confirms, move to answering
      return updateDialogueContext(current, {
        state: "answering",
      });

    case "answering":
    case "following_up":
      // If user asks something new, re-evaluate intent
      if (intentResult.intent !== current.intent && intentResult.confidence > 0.5) {
        return updateDialogueContext(current, {
          state: shouldGatherInfo(intentResult.intent) ? "info_gather" : "answering",
          intent: intentResult.intent,
          intentConfidence: intentResult.confidence,
        });
      }
      return updateDialogueContext(current, {
        state: "following_up",
      });

    case "handing_off":
      // While waiting for human, stay in handing_off
      return updateDialogueContext(current, {
        state: "handing_off",
      });

    case "closed":
      // Re-open conversation
      return updateDialogueContext(current, {
        state: "greeting",
      });

    default:
      return updateDialogueContext(current, {});
  }
}

function handleAgentResponse(current: DialogueContext): DialogueContext {
  const { state } = current;

  switch (state) {
    case "answering":
      // Agent answered — move to following_up
      return updateDialogueContext(current, {
        state: "following_up",
      });

    default:
      return updateDialogueContext(current, {});
  }
}

function handleInfoCollected(
  current: DialogueContext,
  event: { type: "info_collected"; fields: Record<string, string> },
): DialogueContext {
  return updateDialogueContext(current, {
    state: "confirming",
    collectedInfo: { ...current.collectedInfo, ...event.fields },
  });
}

function handleHandoffRequest(
  current: DialogueContext,
  event: { type: "handoff_request"; reason: string },
): DialogueContext {
  return updateDialogueContext(current, {
    state: "handing_off",
    handoffReason: event.reason,
  });
}

function handleSessionTimeout(current: DialogueContext): DialogueContext {
  return updateDialogueContext(current, {
    state: "idle",
    intent: undefined,
    intentConfidence: undefined,
  });
}

function handleSessionClose(current: DialogueContext): DialogueContext {
  return updateDialogueContext(current, {
    state: "closed",
  });
}

function handleIntentDetected(
  current: DialogueContext,
  event: { type: "intent_detected"; intent: KfIntent; confidence?: number },
): DialogueContext {
  return updateDialogueContext(current, {
    intent: event.intent,
    intentConfidence: event.confidence,
    state: shouldGatherInfo(event.intent) ? "info_gather" : "answering",
  });
}

function shouldGatherInfo(intent: KfIntent): boolean {
  // Aftersale and technical support typically need more info
  return intent === "aftersale_issue" || intent === "technical_support";
}
