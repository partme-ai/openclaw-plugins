/**
 * @module agent/asr
 *
 * KF 入站语音转文字（ASR），薄封装 message-sdk 腾讯云 Flash ASR。
 * 配置路径：`channels.wecom-kf.accounts.<id>.asr` 或账号级 merged config。
 */

import {
  transcribeTencentFlash,
  type TencentFlashASRConfig,
} from "@partme.ai/openclaw-message-sdk/asr";
import type { ResolvedAgentAccount } from "../types/index.js";

/**
 * 将语音 Buffer 转为文本。
 */
export async function transcribeKfVoice(
  account: ResolvedAgentAccount,
  audioBuffer: Buffer,
  asrConfig?: Partial<TencentFlashASRConfig>,
): Promise<string> {
  const accountAsrConfig = (account.config as { asr?: TencentFlashASRConfig }).asr;

  if (!accountAsrConfig && !asrConfig) {
    throw new Error(
      "ASR credentials not configured. Add channels.wecom-kf.accounts.<id>.asr or pass asrConfig.",
    );
  }

  const config: TencentFlashASRConfig = {
    appId: asrConfig?.appId || accountAsrConfig?.appId || "",
    secretId: asrConfig?.secretId || accountAsrConfig?.secretId || "",
    secretKey: asrConfig?.secretKey || accountAsrConfig?.secretKey || "",
    engineType: asrConfig?.engineType || accountAsrConfig?.engineType || "16k_zh",
    voiceFormat: asrConfig?.voiceFormat || accountAsrConfig?.voiceFormat || "amr",
    timeoutMs: asrConfig?.timeoutMs || accountAsrConfig?.timeoutMs || 30_000,
  };

  if (!config.appId || !config.secretId || !config.secretKey) {
    throw new Error("ASR credentials incomplete (appId, secretId, secretKey required).");
  }

  return transcribeTencentFlash({ audio: audioBuffer, config });
}

/**
 * 判断当前账号是否已配置完整 ASR 凭据。
 */
export function isKfVoiceAsrEnabled(account: ResolvedAgentAccount): boolean {
  const asrConfig = (account.config as { asr?: TencentFlashASRConfig }).asr;
  return Boolean(asrConfig?.appId && asrConfig?.secretId && asrConfig?.secretKey);
}

export type { TencentFlashASRConfig };
