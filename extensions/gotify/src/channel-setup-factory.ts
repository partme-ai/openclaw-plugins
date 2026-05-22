/**
 * 共享 Channel setupWizard / setupAdapter 工厂。
 *
 * 供 extensions 下各渠道插件复用，减少重复声明式向导代码。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type {
  ChannelSetupAdapter,
  ChannelSetupWizard,
} from "openclaw/plugin-sdk/setup";
import {
  applySetupAccountConfigPatch,
  createPatchedAccountSetupAdapter,
  createStandardChannelSetupStatus,
  setSetupChannelEnabled,
} from "openclaw/plugin-sdk/setup";

/**
 * 单条凭据字段映射。
 *
 * 用于把 setup CLI 的通用输入键（如 token、secret、baseUrl）映射到具体渠道的
 * `channels.<id>` 配置键，并描述密钥字段的帮助文案和现值读取逻辑。
 */
export type SetupCredentialSpec = {
  inputKey:
    | "token"
    | "secret"
    | "url"
    | "baseUrl"
    | "botToken"
    | "appToken"
    | "privateKey";
  configKey: string;
  label: string;
  preferredEnvVar?: string;
  helpTitle?: string;
  helpLines?: string[];
  inputPrompt: string;
  getValue: (cfg: OpenClawConfig, accountId?: string) => string | undefined;
};

/**
 * 单条文本输入映射。
 *
 * 文本输入适合 URL、端口、webhookPath 等非密钥字段；凭据字段应优先使用
 * `SetupCredentialSpec`，以便宿主可以执行密钥遮罩和环境变量提示。
 */
export type SetupTextInputSpec = {
  inputKey:
    | "url"
    | "baseUrl"
    | "httpPort"
    | "webhookPath"
    | "webhookUrl"
    | "token"
    | "secret";
  configKey: string;
  message: string;
  placeholder?: string;
  helpTitle?: string;
  helpLines?: string[];
  getValue: (cfg: OpenClawConfig, accountId?: string) => string | undefined;
  required?: boolean;
};

/**
 * 创建标准渠道 setup 表面所需的声明式参数。
 *
 * 该类型让各渠道只声明“需要哪些字段”和“如何判断已配置”，通用的状态展示、
 * patch 写入、完成提示和禁用逻辑由工厂统一生成。
 */
export type SimpleChannelSetupParams = {
  /** 渠道 ID，例如 `gotify`。 */
  channel: string;
  /** 面向用户的渠道名称。 */
  label: string;
  /** 渠道文档路径。 */
  docsPath?: string;
  /** 判断指定账号是否已经完成最小配置。 */
  resolveConfigured: (cfg: OpenClawConfig, accountId?: string) => boolean;
  /** 需要通过密钥流程采集的字段。 */
  credentials?: SetupCredentialSpec[];
  /** 需要通过普通文本输入采集的字段。 */
  textInputs?: SetupTextInputSpec[];
  /** 未配置时展示的引导说明。 */
  introLines?: string[];
  /** 配置完成后展示的收尾说明。 */
  completionLines?: string[];
  /** 自定义收尾逻辑；未提供时默认启用渠道。 */
  finalize?: NonNullable<ChannelSetupWizard["finalize"]>;
};

/**
 * 读取 channels.<channel> 配置节。
 *
 * @param cfg - OpenClaw 当前配置。
 * @param channel - 渠道 ID。
 * @returns 渠道配置节；未配置时返回空对象。
 */
export function getChannelSection(
  cfg: OpenClawConfig,
  channel: string,
): Record<string, unknown> {
  return ((cfg.channels as Record<string, unknown> | undefined)?.[channel] ??
    {}) as Record<string, unknown>;
}

/**
 * 创建标准 declarative Channel setup 表面（adapter + wizard）。
 *
 * 该工厂把重复的 setup 行为收敛到一个地方：输入值读取、patch 写入、状态判断、
 * intro/completion note 和禁用逻辑。Gotify 当前只使用其中一部分，但保留通用工厂
 * 方便同一批消息渠道沿用一致的 setup 交互。
 *
 * @param params - 渠道 setup 声明。
 * @returns OpenClaw setup adapter 与 setup wizard。
 */
export function createSimpleChannelSetup(params: SimpleChannelSetupParams): {
  setupAdapter: ChannelSetupAdapter;
  setupWizard: ChannelSetupWizard;
} {
  const { channel, label } = params;

  const setupAdapter = createPatchedAccountSetupAdapter({
    channelKey: channel,
    validateInput: () => null,
    buildPatch: (input: Record<string, unknown>) => {
      const patch: Record<string, unknown> = {};
      /*
       * setup 输入来自统一 CLI 表单，不同渠道字段名不同。
       * 这里仅写入非空字符串，避免用户跳过某个字段时把已有配置覆盖为空。
       */
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
      resolveConfigured: ({
        cfg,
        accountId,
      }: {
        cfg: OpenClawConfig;
        accountId?: string;
      }) => params.resolveConfigured(cfg, accountId),
    }),
    introNote: params.introLines?.length
      ? {
          title: `${label} 设置`,
          lines: params.introLines,
          shouldShow: ({
            cfg,
            accountId,
          }: {
            cfg: OpenClawConfig;
            accountId?: string;
          }) => !params.resolveConfigured(cfg, accountId),
        }
      : undefined,
    credentials: (params.credentials ?? []).map((spec) => ({
      inputKey: spec.inputKey,
      providerHint: label,
      credentialLabel: spec.label,
      preferredEnvVar: spec.preferredEnvVar,
      helpTitle: spec.helpTitle,
      helpLines: spec.helpLines,
      envPrompt: spec.preferredEnvVar
        ? `使用环境变量 ${spec.preferredEnvVar}？`
        : `使用环境变量中的 ${spec.label}？`,
      keepPrompt: `${spec.label} 已配置，保留当前值？`,
      inputPrompt: spec.inputPrompt,
      inspect: ({
        cfg,
        accountId,
      }: {
        cfg: OpenClawConfig;
        accountId?: string;
      }) => {
        const value = spec.getValue(cfg, accountId)?.trim();
        const hasValue = Boolean(value);
        return {
          accountConfigured: hasValue,
          hasConfiguredValue: hasValue,
          resolvedValue: value,
        };
      },
      applySet: ({
        cfg,
        resolvedValue,
        accountId,
      }: {
        cfg: OpenClawConfig;
        resolvedValue: string;
        accountId?: string;
      }) =>
        applySetupAccountConfigPatch({
          cfg,
          channelKey: channel,
          accountId: accountId ?? "default",
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
      currentValue: ({
        cfg,
        accountId,
      }: {
        cfg: OpenClawConfig;
        accountId?: string;
      }) => spec.getValue(cfg, accountId),
      applySet: ({
        cfg,
        value,
        accountId,
      }: {
        cfg: OpenClawConfig;
        value: string;
        accountId?: string;
      }) =>
        applySetupAccountConfigPatch({
          cfg,
          channelKey: channel,
          accountId: accountId ?? "default",
          patch: { [spec.configKey]: value.trim() },
        }),
    })),
    finalize:
      params.finalize ??
      (async ({
        cfg,
        accountId,
      }: {
        cfg: OpenClawConfig;
        accountId?: string;
      }) => {
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
          shouldShow: ({
            cfg,
            accountId,
          }: {
            cfg: OpenClawConfig;
            accountId?: string;
          }) => params.resolveConfigured(cfg, accountId),
        }
      : undefined,
    disable: (cfg: OpenClawConfig) =>
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
 * 基于连接 URL 的 MQ/消息中间件渠道 setup（channels.<id>.url）。
 *
 * @param params - URL 型渠道 setup 选项。
 * @returns OpenClaw setup adapter 与 setup wizard。
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
      ((cfg) =>
        Boolean(
          String(getChannelSection(cfg, params.channel)[urlField] ?? "").trim(),
        )),
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
 * 双凭据渠道 setup（如 app_key + app_secret，映射到 token + secret 输入）。
 *
 * @param params - 双凭据渠道 setup 选项。
 * @returns OpenClaw setup adapter 与 setup wizard。
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
      return Boolean(
        String(section[keyField] ?? "").trim() &&
        String(section[secretField] ?? "").trim(),
      );
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
 * 仅启用 embedded broker 类渠道（配置节存在即视为已配置）。
 *
 * @param params - 内嵌 broker 渠道 setup 选项。
 * @returns OpenClaw setup adapter 与 setup wizard。
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
    finalize: async ({
      cfg,
      accountId,
    }: {
      cfg: OpenClawConfig;
      accountId?: string;
    }) => ({
      cfg: setSetupChannelEnabled(
        applySetupAccountConfigPatch({
          cfg,
          channelKey: params.channel,
          accountId: accountId ?? "default",
          patch: { enabled: true },
        }),
        params.channel,
        true,
      ),
    }),
  });
}
