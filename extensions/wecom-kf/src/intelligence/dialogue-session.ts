/**
 * KF 对话状态机 — session extension 读写与入/出站 transition 编排。
 *
 * 入站 dispatch 写入状态，before_prompt_build 读取并注入 prompt，形成闭环。
 */

import type { OpenClawConfig, OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk/core";

import {
  type DialogueContext,
  DIALOGUE_SESSION_NAMESPACE,
  createDialogueContext,
} from "./dialogue-state.js";
import { transitionState } from "./dialogue-transitions.js";

const PLUGIN_ID = "wecom-kf";

type SessionStoreEntry = {
  pluginExtensions?: Record<string, Record<string, unknown>>;
};

/**
 * 注册 OpenClaw session extension，供 Gateway 投影 dialogue 状态。
 */
export function registerDialogueSessionExtension(api: OpenClawPluginApi): void {
  api.session?.state?.registerSessionExtension?.({
    namespace: DIALOGUE_SESSION_NAMESPACE,
    description: "WeCom KF dialogue state machine context",
  });
}

/**
 * 判断未知值是否为 DialogueContext。
 */
function isDialogueContext(value: unknown): value is DialogueContext {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.state === "string" && typeof record.sessionId === "string";
}

/**
 * 从 session entry 的 pluginExtensions 读取 dialogue 上下文。
 */
function readDialogueFromEntry(entry: SessionStoreEntry | undefined): DialogueContext | undefined {
  const raw = entry?.pluginExtensions?.[PLUGIN_ID]?.[DIALOGUE_SESSION_NAMESPACE];
  return isDialogueContext(raw) ? raw : undefined;
}

/**
 * 解析 session store 路径。
 */
function resolveSessionStorePath(params: {
  runtime: PluginRuntime;
  cfg: OpenClawConfig;
  agentId?: string;
}): string | undefined {
  return params.runtime.agent?.session?.resolveStorePath?.(params.cfg.session?.store, {
    agentId: params.agentId,
  });
}

/**
 * 加载（或初始化）当前 session 的对话上下文。
 */
export async function loadDialogueContext(params: {
  runtime: PluginRuntime;
  cfg: OpenClawConfig;
  sessionKey: string;
  agentId?: string;
  userId: string;
}): Promise<DialogueContext> {
  const storePath = resolveSessionStorePath(params);
  if (!storePath) {
    return createDialogueContext({ sessionId: params.sessionKey, userId: params.userId });
  }

  const entry = params.runtime.agent.session.getSessionEntry({
    storePath,
    sessionKey: params.sessionKey,
    readConsistency: "latest",
  });
  const existing = readDialogueFromEntry(entry);
  if (existing) {
    return existing;
  }

  return createDialogueContext({ sessionId: params.sessionKey, userId: params.userId });
}

/**
 * 将对话上下文持久化到 session extension。
 */
export async function persistDialogueContext(params: {
  runtime: PluginRuntime;
  cfg: OpenClawConfig;
  sessionKey: string;
  agentId?: string;
  context: DialogueContext;
}): Promise<void> {
  const updateSessionStoreEntry = params.runtime.agent?.session?.updateSessionStoreEntry;
  const storePath = resolveSessionStorePath(params);
  if (!updateSessionStoreEntry || !storePath) {
    return;
  }

  const serialized = { ...params.context, collectedInfo: { ...params.context.collectedInfo } };

  await updateSessionStoreEntry({ storePath, sessionKey: params.sessionKey, update: (entry) => {
    const pluginExtensions = { ...(entry.pluginExtensions ?? {}) };
    const pluginState = { ...(pluginExtensions[PLUGIN_ID] ?? {}) };
    pluginState[DIALOGUE_SESSION_NAMESPACE] = serialized;
    pluginExtensions[PLUGIN_ID] = pluginState;
    return { pluginExtensions };
  }});
}

/**
 * 入站用户消息：transitionState(user_message) 并持久化。
 */
export async function applyInboundDialogueTransition(params: {
  runtime: PluginRuntime;
  cfg: OpenClawConfig;
  sessionKey: string;
  agentId?: string;
  userId: string;
  text: string;
}): Promise<DialogueContext> {
  const current = await loadDialogueContext(params);
  const next = transitionState(current, { type: "user_message", text: params.text });
  await persistDialogueContext({ ...params, context: next });
  return next;
}

/**
 * Agent 出站回复后：transitionState(agent_response) 并持久化。
 */
export async function applyOutboundDialogueTransition(params: {
  runtime: PluginRuntime;
  cfg: OpenClawConfig;
  sessionKey: string;
  agentId?: string;
  userId: string;
}): Promise<void> {
  const current = await loadDialogueContext(params);
  const next = transitionState(current, { type: "agent_response", text: "" });
  await persistDialogueContext({ ...params, context: next });
}
