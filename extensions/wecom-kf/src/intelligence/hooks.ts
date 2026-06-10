/**
 * 智能化层 OpenClaw hooks：dialogue state → before_prompt_build 闭环。
 */

import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";

import { buildStateAwarePrompt } from "./prompt-builder.js";
import { loadDialogueContext, registerDialogueSessionExtension } from "./dialogue-session.js";

/**
 * 注册 dialogue session extension 与 before_prompt_build 注入逻辑。
 */
export function registerIntelligenceHooks(api: OpenClawPluginApi): void {
  registerDialogueSessionExtension(api);

  api.on("before_prompt_build", async (_event, ctx) => {
    if (ctx.channelId !== "wecom-kf") {
      return;
    }

    const surface = (ctx as Record<string, unknown>).surface;
    if (surface && surface !== "wecom-kf") {
      return;
    }

    const sessionKey = ctx.sessionKey?.trim();
    if (!sessionKey) {
      return;
    }

    try {
      const runtime = api.runtime;
      const cfg = ((runtime as { config?: OpenClawConfig }).config ??
        (api as { config?: OpenClawConfig }).config) as OpenClawConfig | undefined;
      if (!cfg) {
        return;
      }

      const dialogueCtx = await loadDialogueContext({
        runtime,
        cfg,
        sessionKey,
        agentId: ctx.agentId,
        userId: "",
      });

      if (dialogueCtx.turnCount === 0 && dialogueCtx.state === "idle") {
        return;
      }

      const statePrompt = buildStateAwarePrompt(dialogueCtx);
      if (!statePrompt) {
        return;
      }

      return { systemPrompt: statePrompt };
    } catch {
      // 非阻塞：状态流失败不影响主对话
    }
  });
}
