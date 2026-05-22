/**
 * Voice ASR - Agent Mode（腾讯云 Flash ASR，企微插件内置实现）。
 */

import type { ResolvedAgentAccount } from "../types/index.js";
import {
  transcribeTencentFlash,
  type TencentFlashASRConfig,
} from "./tencent-flash-asr.js";

/** 语音转文字 */
export async function transcribeVoice(
  account: ResolvedAgentAccount,
  audioBuffer: Buffer,
  asrConfig?: Partial<TencentFlashASRConfig>,
): Promise<string> {
  const accountAsrConfig = (account.config as { asr?: TencentFlashASRConfig }).asr;

  if (!accountAsrConfig && !asrConfig) {
    throw new Error(
      "ASR credentials not configured. Add channels.wecom.agent.asr or pass asrConfig.",
    );
  }

  const config: TencentFlashASRConfig = {
    appId: asrConfig?.appId || accountAsrConfig?.appId || "",
    secretId: asrConfig?.secretId || accountAsrConfig?.secretId || "",
    secretKey: asrConfig?.secretKey || accountAsrConfig?.secretKey || "",
    engineType: asrConfig?.engineType || accountAsrConfig?.engineType || "16k_zh",
    voiceFormat: asrConfig?.voiceFormat || accountAsrConfig?.voiceFormat || "amr",
    timeoutMs: asrConfig?.timeoutMs || accountAsrConfig?.timeoutMs || 30000,
  };

  if (!config.appId || !config.secretId || !config.secretKey) {
    throw new Error("ASR credentials incomplete (appId, secretId, secretKey required).");
  }

  return transcribeTencentFlash({ audio: audioBuffer, config });
}

/** 是否启用 ASR */
export function isVoiceAsrEnabled(account: ResolvedAgentAccount): boolean {
  const asrConfig = (account.config as { asr?: TencentFlashASRConfig }).asr;
  return Boolean(asrConfig?.appId && asrConfig?.secretId && asrConfig?.secretKey);
}

export type { TencentFlashASRConfig };
