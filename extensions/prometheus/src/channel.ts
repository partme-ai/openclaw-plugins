/**
 * @description Prometheus infra 占位 Channel：满足 Base Profile 与 setupEntry 冷路径契约。
 */

import { prometheusSetupAdapter, prometheusSetupWizard } from "./onboarding.js";

/** 插件 ID（与 openclaw.plugin.json#id 一致）。 */
export const PROMETHEUS_CHANNEL_ID = "prometheus";

/**
 * Setup 冷路径使用的最小 Channel 描述。
 * 本插件无 messaging channel，仅满足 Base Profile 与 setupEntry 契约。
 */
export const prometheusChannel = {
  id: PROMETHEUS_CHANNEL_ID,
  meta: {
    id: PROMETHEUS_CHANNEL_ID,
    label: "Prometheus",
    selectionLabel: "Prometheus Metrics Exporter",
    docsPath: "/plugins/prometheus",
    blurb: "Prometheus metrics exporter for OpenClaw Gateway.",
  },
  capabilities: {
    chatTypes: [] as const,
  },
  setupWizard: prometheusSetupWizard,
  setup: prometheusSetupAdapter,
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({ accountId: "default", enabled: true, configured: true }),
  },
} as const;
