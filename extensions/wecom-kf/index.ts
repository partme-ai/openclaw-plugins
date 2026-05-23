import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema, ensureConfigHelpers } from "./src/compat/plugin-sdk-shim.js";

import { handleWecomWebhookRequest } from "./src/monitor.js";
import { setWecomRuntime } from "./src/runtime.js";
import { wecomPlugin } from "./src/channel.js";
import { createWeComMcpTool } from "./src/mcp/index.js";
import { createKfCallbackHandler } from "./src/callback.js";
import { createKfAccountConfigGetter } from "./src/config/kf-callback.js";
import {
  collectWecomKfRoutePaths,
  isLegacyWecomCsEnabled,
} from "./src/config/kf-routes.js";
import { WEBHOOK_PATHS } from "./src/types/constants.js";
import type { WecomKfConfig } from "./src/types/config.js";

// ── KF State Flow ──
import { DIALOGUE_SESSION_NAMESPACE, buildStateAwarePrompt } from "./src/kf/index.js";

// ── KF Agent Tools ──
import {
  createKfServicerListTool,
  createKfAccountListTool,
  createKfAccountLinkTool,
  createKfSessionStatusTool,
  createKfSessionTransferTool,
} from "./src/kf/tools.js";
import {
  createWecomKfListServicersTool,
  createWecomKfListAccountsTool,
  createWecomKfGetAccountLinkTool,
  createWecomKfTransferSessionTool,
} from "./src/kf/control-tools.js";

// ── ICS (Intelligent Customer Service) REST API ──
import { createKnowledgeHandler } from "./src/ics-handlers/knowledge.js";
import { createBindingsHandler } from "./src/ics-handlers/bindings.js";
import { createEventMessagesHandler } from "./src/ics-handlers/event-messages.js";
import { createStatsHandler } from "./src/ics-handlers/stats.js";

const plugin = {
  id: "wecom-kf",
  name: "WeCom KF",
  description: "OpenClaw WeCom KF (WeChat Work Customer Service) — multi-agent mapping + ICS REST API",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    void ensureConfigHelpers();

    setWecomRuntime(api.runtime);
    api.registerChannel({ plugin: wecomPlugin });

    const getOpenClawConfig = (): OpenClawConfig | undefined =>
      (api.runtime as { config?: OpenClawConfig }).config;

    const kfCallbackHandler = createKfCallbackHandler(createKfAccountConfigGetter(getOpenClawConfig));
    const handleKfWebhookRequest = async (
      req: Parameters<typeof kfCallbackHandler>[0],
      res: Parameters<typeof kfCallbackHandler>[1],
    ): Promise<boolean> => {
      await kfCallbackHandler(req, res);
      return true;
    };

    // KF 客服回调（主路径；支持顶层与 accounts.*.webhookPath）
    const initialCfg = getOpenClawConfig();
    const kfChannelConfig = initialCfg?.channels?.["wecom-kf"] as WecomKfConfig | undefined;
    for (const path of collectWecomKfRoutePaths(kfChannelConfig)) {
      api.registerHttpRoute({
        path,
        handler: handleKfWebhookRequest,
        auth: "plugin",
        match: "prefix",
      });
    }

    // Legacy wecom-cs Bot / Agent 回调（Phase 2 删除；默认不注册）
    if (isLegacyWecomCsEnabled(initialCfg)) {
      const csRoutes = [
        WEBHOOK_PATHS.BOT_PLUGIN,
        WEBHOOK_PATHS.BOT,
        WEBHOOK_PATHS.BOT_ALT,
        WEBHOOK_PATHS.AGENT_PLUGIN,
        WEBHOOK_PATHS.AGENT,
      ];
      for (const path of csRoutes) {
        api.registerHttpRoute({
          path,
          handler: handleWecomWebhookRequest,
          auth: "plugin",
          match: "prefix",
        });
      }
    }

    // ── ICS REST API routes (merged from @partme.ai/ics) ──
    const runtime = api.runtime as unknown as Parameters<typeof createKnowledgeHandler>[0];
    api.registerHttpRoute({ path: "/ics/agents", handler: createKnowledgeHandler(runtime), auth: "plugin" });
    api.registerHttpRoute({ path: "/ics/config/bindings", handler: createBindingsHandler(runtime), auth: "plugin" });
    api.registerHttpRoute({ path: "/ics/config/event-messages", handler: createEventMessagesHandler(runtime), auth: "plugin" });
    api.registerHttpRoute({ path: "/ics/stats/overview", handler: createStatsHandler(runtime), auth: "plugin" });

    // Register wecom_kf_mcp
    api.registerTool(createWeComMcpTool(), { name: "wecom_kf_mcp" });

    // ── KF Agent Tools (客服行为) ──
    api.registerTool(createKfServicerListTool(), { name: "wecom_kf_servicer_list", optional: true });
    api.registerTool(createKfAccountListTool(), { name: "wecom_kf_account_list", optional: true });
    api.registerTool(createKfAccountLinkTool(), { name: "wecom_kf_account_link", optional: true });
    api.registerTool(createKfSessionStatusTool(), { name: "wecom_kf_session_status", optional: true });
    api.registerTool(createKfSessionTransferTool(), { name: "wecom_kf_session_transfer", optional: true });

    // ── KF 控制面 Tools（API 响应不进 LLM 上下文） ──
    api.registerTool(
      (ctx) => createWecomKfListServicersTool({ ...ctx, config: getOpenClawConfig() }),
      { name: "wecom_kf_list_servicers", optional: true },
    );
    api.registerTool(
      (ctx) => createWecomKfListAccountsTool({ ...ctx, config: getOpenClawConfig() }),
      { name: "wecom_kf_list_accounts", optional: true },
    );
    api.registerTool(
      (ctx) => createWecomKfGetAccountLinkTool({ ...ctx, config: getOpenClawConfig() }),
      { name: "wecom_kf_get_account_link", optional: true },
    );
    api.registerTool(
      (ctx) => createWecomKfTransferSessionTool({ ...ctx, config: getOpenClawConfig() }),
      { name: "wecom_kf_transfer_session", optional: true },
    );

    // State-aware dialogue prompt injection for KF sessions
    api.on("before_prompt_build", async (_event, ctx) => {
      // Only inject for wecom-kf channel KF surface sessions
      if (ctx.channelId !== "wecom-kf") return;
      if ((ctx as Record<string, unknown>).surface !== "wecom-kf") return;

      // Load dialogue context
      try {
        const sessionExt = (api as Record<string, unknown>).session as { state?: { get?: (namespace: string) => Promise<Record<string, unknown> | undefined> } } | undefined;
        const getState = sessionExt?.state?.get as
          ((namespace: string) => Promise<Record<string, unknown> | undefined>) | undefined;
        const dialogueCtx = await getState?.(DIALOGUE_SESSION_NAMESPACE);
        if (!dialogueCtx) return;

        const statePrompt = buildStateAwarePrompt(dialogueCtx as Parameters<typeof buildStateAwarePrompt>[0]);
        if (!statePrompt) return;

        return {
          systemPrompt: statePrompt,
        };
      } catch {
        // Non-blocking: if state flow fails, don't break the conversation
      }
    });

    // MEDIA instruction prompt injection (for all wecom-kf channel sessions)
    api.on("before_prompt_build", (_event, ctx) => {
      if (ctx.channelId !== "wecom-kf") return;
      return {
        systemPrompt: [
          "【发送文件/图片/视频/语音】",
          "当你需要向用户发送文件、图片、视频或语音时，必须在回复中单独一行使用 MEDIA: 指令，后面跟文件的本地路径。",
          "格式：MEDIA: /文件的绝对路径",
          "文件优先存放到 ~/.openclaw 目录下，确保路径可访问。",
          "示例：",
          "  MEDIA: ~/.openclaw/output.png",
          "  MEDIA: ~/.openclaw/report.pdf",
          "系统会自动识别文件类型并发送给用户。",
          "",
          "注意事项：",
          "- MEDIA: 必须在行首，后面紧跟文件路径（不是 URL）",
          "- 如果路径中包含空格，可以用反引号包裹：MEDIA: `/path/to/my file.png`",
          "- 每个文件单独一行 MEDIA: 指令",
          "- 可以在 MEDIA: 指令前后附带文字说明",
          "",
          "【文件大小限制】",
          "- 图片不超过 10MB，视频不超过 10MB，语音不超过 2MB（仅支持 AMR 格式），文件不超过 20MB",
          "- 语音消息仅支持 AMR 格式（.amr），如需发送语音请确保文件为 AMR 格式",
          "- 超过大小限制的图片/视频/语音会被自动转为文件格式发送",
          "- 如果文件超过 20MB，将无法发送，请提前告知用户并尝试缩减文件大小",
        ].join("\n"),
      };
    });
  },
};

export default plugin;
