/**
 * 共享 Channel setupWizard / setupAdapter 工厂。
 *
 * **架构角色**：extensions 下各渠道插件的声明式 CLI 配置复用层。
 *
 * **关键依赖**：`openclaw/plugin-sdk/setup`
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { ChannelSetupAdapter, ChannelSetupWizard } from "openclaw/plugin-sdk/setup";
import {
  applySetupAccountConfigPatch,
  createPatchedAccountSetupAdapter,
  createStandardChannelSetupStatus,
  setSetupChannelEnabled,
} from "openclaw/plugin-sdk/setup";

/** 单条凭据字段映射（CLI inputKey → channels.<id> 配置键） */
export type SetupCredentialSpec = {
  inputKey: "token" | "secret" | "url" | "baseUrl" | "botToken" | "appToken" | "privateKey";
  configKey: string;
  label: string;
  preferredEnvVar?: string;
  helpTitle?: string;
  helpLines?: string[];
  inputPrompt: string;
  getValue: (cfg: OpenClawConfig, accountId?: string) => string | undefined;
};

/** 单条文本输入映射（CLI inputKey → channels.<id> 配置键） */
export type SetupTextInputSpec = {
  inputKey: "url" | "baseUrl" | "httpPort" | "webhookPath" | "webhookUrl" | "token" | "secret";
  configKey: string;
  message: string;
  placeholder?: string;
  helpTitle?: string;
  helpLines?: string[];
  getValue: (cfg: OpenClawConfig, accountId?: string) => string | undefined;
  required?: boolean;
};

/** `createSimpleChannelSetup` 入参 */
export type SimpleChannelSetupParams = {
  channel: string;
  label: string;
  docsPath?: string;
  resolveConfigured: (cfg: OpenClawConfig, accountId?: string) => boolean;
  credentials?: SetupCredentialSpec[];
  textInputs?: SetupTextInputSpec[];
  introLines?: string[];
  completionLines?: string[];
  finalize?: NonNullable<ChannelSetupWizard["finalize"]>;
};

/**
 * 读取 `openclaw.json` 中指定渠道配置节。
 *
 * @param cfg OpenClaw 全局配置
 * @param channel 渠道 id
 * @returns 原始配置对象
 */
export function getChannelSection(cfg: OpenClawConfig, channel: string): Record<string, unknown> {
  return ((cfg.channels as Record<string, unknown> | undefined)?.[channel] ?? {}) as Record<
    string,
    unknown
  >;
}

/**
 * 创建标准声明式 Channel setup 表面（adapter + wizard）。
 *
 * @param params 渠道标识与输入字段规格
 * @returns setupAdapter 与 setupWizard
 */
export function createSimpleChannelSetup(params: SimpleChannelSetupParams): {
  setupAdapter: ChannelSetupAdapter;
  setupWizard: ChannelSetupWizard;
} {
  const { channel, label } = params;

  const setupAdapter = createPatchedAccountSetupAdapter({
    channelKey: channel,
    validateInput: () => null,
    buildPatch: (input) => {
      const patch: Record<string, unknown> = {};
      for (const spec of params.credentials ?? []) {
        const raw = input[spec.inputKey];
        if (typeof raw === "string" && raw.trim()) {
          patch[spec.configKey] = raw.trim();
        }
      }
      for (const spec of params.textInputs ?? []) {
        const raw = input[spec.inputKey];
        if (typeof raw === "string" && raw.trim()) {
          patch[spec.configKey] = raw.trim();
        }
      }
      return patch;
    },
  });

  const setupWizard: ChannelSetupWizard = {
    channel,
    status: createStandardChannelSetupStatus({
      channelLabel: label,
      configuredLabel: "已配置 ✓",
      unconfiguredLabel: "需要配置",
      configuredHint: "已配置",
      unconfiguredHint: "需要设置",
      resolveConfigured: ({ cfg, accountId }) => params.resolveConfigured(cfg, accountId),
    }),
    introNote: params.introLines?.length
      ? {
          title: `${label} 设置`,
          lines: params.introLines,
          shouldShow: ({ cfg, accountId }) => !params.resolveConfigured(cfg, accountId),
        }
      : undefined,
    credentials: (params.credentials ?? []).map((spec) => ({
      inputKey: spec.inputKey,
      providerHint: label,
      credentialLabel: spec.label,
      preferredEnvVar: spec.preferredEnvVar,
      helpTitle: spec.helpTitle,
      helpLines: spec.helpLines,
      envPrompt: spec.preferredEnvVar ? `使用环境变量 ${spec.preferredEnvVar}？` : `使用环境变量中的 ${spec.label}？`,
      keepPrompt: `${spec.label} 已配置，保留当前值？`,
      inputPrompt: spec.inputPrompt,
      inspect: ({ cfg, accountId }) => {
        const value = spec.getValue(cfg, accountId)?.trim();
        const hasValue = Boolean(value);
        return {
          accountConfigured: hasValue,
          hasConfiguredValue: hasValue,
          resolvedValue: value,
        };
      },
      applySet: ({ cfg, resolvedValue, accountId }) =>
        applySetupAccountConfigPatch({
          cfg,
          channelKey: channel,
          accountId,
          patch: { [spec.configKey]: resolvedValue },
        }),
    })),
    textInputs: (params.textInputs ?? []).map((spec) => ({
      inputKey: spec.inputKey,
      message: spec.message,
      placeholder: spec.placeholder,
      required: spec.required ?? true,
      helpTitle: spec.helpTitle,
      helpLines: spec.helpLines,
      currentValue: ({ cfg, accountId }) => spec.getValue(cfg, accountId),
      applySet: ({ cfg, value, accountId }) =>
        applySetupAccountConfigPatch({
          cfg,
          channelKey: channel,
          accountId,
          patch: { [spec.configKey]: value.trim() },
        }),
    })),
    finalize: params.finalize ?? (async ({ cfg, accountId }) => {
      if (!params.resolveConfigured(cfg, accountId)) {
        return undefined;
      }
      return {
        cfg: setSetupChannelEnabled(cfg, channel, true),
      };
    }),
    completionNote: params.completionLines?.length
      ? {
          title: `${label} 配置完成`,
          lines: params.completionLines,
          shouldShow: ({ cfg, accountId }) => params.resolveConfigured(cfg, accountId),
        }
      : undefined,
    disable: (cfg) =>
      applySetupAccountConfigPatch({
        cfg,
        channelKey: channel,
        accountId: "default",
        patch: { enabled: false },
      }),
  };

  return { setupAdapter, setupWizard };
}

/**
 * 基于连接 URL 的消息中间件类渠道 setup。
 *
 * @param params 渠道元数据与默认 URL
 * @returns setupAdapter 与 setupWizard
 */
export function createUrlChannelSetup(params: {
  channel: string;
  label: string;
  docsPath: string;
  urlField?: string;
  defaultUrl: string;
  envVar?: string;
  resolveConfigured?: (cfg: OpenClawConfig) => boolean;
  introLines?: string[];
}): { setupAdapter: ChannelSetupAdapter; setupWizard: ChannelSetupWizard } {
  const urlField = params.urlField ?? "url";
  return createSimpleChannelSetup({
    channel: params.channel,
    label: params.label,
    docsPath: params.docsPath,
    resolveConfigured:
      params.resolveConfigured ??
      ((cfg) => Boolean(String(getChannelSection(cfg, params.channel)[urlField] ?? "").trim())),
    introLines: params.introLines ?? [
      `${params.label} 通过连接 URL 接入 OpenClaw。`,
      `默认示例：${params.defaultUrl}`,
    ],
    completionLines: [
      `${params.label} 已写入 openclaw.json。`,
      "运行 `openclaw gateway restart` 使配置生效。",
    ],
    textInputs: [
      {
        inputKey: "url",
        configKey: urlField,
        message: `${params.label} 连接 URL`,
        placeholder: params.defaultUrl,
        getValue: (cfg) => {
          const v = getChannelSection(cfg, params.channel)[urlField];
          return typeof v === "string" ? v : undefined;
        },
      },
    ],
  });
}

/**
 * 双凭据渠道 setup（app_key + app_secret）。
 *
 * @param params 渠道元数据与环境变量提示
 * @returns setupAdapter 与 setupWizard
 */
export function createAppKeySecretChannelSetup(params: {
  channel: string;
  label: string;
  docsPath: string;
  keyField?: string;
  secretField?: string;
  keyEnvVar?: string;
  secretEnvVar?: string;
  introLines?: string[];
}): { setupAdapter: ChannelSetupAdapter; setupWizard: ChannelSetupWizard } {
  const keyField = params.keyField ?? "app_key";
  const secretField = params.secretField ?? "app_secret";
  return createSimpleChannelSetup({
    channel: params.channel,
    label: params.label,
    docsPath: params.docsPath,
    resolveConfigured: (cfg) => {
      const section = getChannelSection(cfg, params.channel);
      return Boolean(String(section[keyField] ?? "").trim() && String(section[secretField] ?? "").trim());
    },
    introLines: params.introLines,
    completionLines: [
      `${params.label} 凭据已保存。`,
      "运行 `openclaw gateway restart` 启动 Webhook 入站。",
    ],
    credentials: [
      {
        inputKey: "token",
        configKey: keyField,
        label: "App Key",
        preferredEnvVar: params.keyEnvVar,
        inputPrompt: `${params.label} App Key`,
        getValue: (cfg) => {
          const v = getChannelSection(cfg, params.channel)[keyField];
          return typeof v === "string" ? v : undefined;
        },
      },
      {
        inputKey: "secret",
        configKey: secretField,
        label: "App Secret",
        preferredEnvVar: params.secretEnvVar,
        inputPrompt: `${params.label} App Secret`,
        getValue: (cfg) => {
          const v = getChannelSection(cfg, params.channel)[secretField];
          return typeof v === "string" ? v : undefined;
        },
      },
    ],
  });
}

/**
 * 内嵌 Broker 类渠道 setup。
 *
 * @param params 渠道元数据
 * @returns setupAdapter 与 setupWizard
 */
export function createEmbeddedBrokerChannelSetup(params: {
  channel: string;
  label: string;
  docsPath: string;
  introLines?: string[];
}): { setupAdapter: ChannelSetupAdapter; setupWizard: ChannelSetupWizard } {
  return createSimpleChannelSetup({
    channel: params.channel,
    label: params.label,
    docsPath: params.docsPath,
    resolveConfigured: (cfg) => Boolean(getChannelSection(cfg, params.channel)),
    introLines: params.introLines ?? [
      `${params.label} 为内嵌 Broker，无需外部连接 URL。`,
      "确认后将写入 channels 配置并启用该渠道。",
    ],
    completionLines: [
      `${params.label} 已启用。`,
      "运行 `openclaw gateway restart` 启动内嵌服务。",
    ],
    credentials: [],
    finalize: async ({ cfg, accountId }) => ({
      cfg: setSetupChannelEnabled(
        applySetupAccountConfigPatch({
          cfg,
          channelKey: params.channel,
          accountId,
          patch: { enabled: true },
        }),
        params.channel,
        true,
      ),
    }),
  });
}
