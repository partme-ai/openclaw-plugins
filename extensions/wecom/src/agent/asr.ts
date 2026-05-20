/**
 * Voice ASR - Agent Mode Capability
 *
 * Automatic speech recognition using Tencent Flash ASR
 * Wraps message-sdk ASR module with WeCom-specific configuration
 *
 * Source: wecom-app voice ASR integration
 */

import type { ResolvedAgentAccount } from "../types/index.js";
import { transcribeTencentFlash, type TencentFlashASRConfig } from "@partme.ai/openclaw-message-sdk";

/**
 * Transcribe voice message using Tencent Flash ASR
 * @param account - Agent account configuration
 * @param audioBuffer - Audio data buffer
 * @param asrConfig - Optional ASR configuration (overrides account defaults)
 * @returns Transcribed text
 */
export async function transcribeVoice(
  account: ResolvedAgentAccount,
  audioBuffer: Buffer,
  asrConfig?: Partial<TencentFlashASRConfig>
): Promise<string> {
  // WeCom-specific ASR configuration
  // Uses Tencent Cloud Flash ASR (optimized for real-time/short audio)
  //
  // Note: This requires Tencent Cloud ASR credentials (appId, secretId, secretKey).
  // These are NOT the same as WeCom credentials (corpId, corpSecret, encodingAESKey).
  //
  // To enable ASR, add ASR credentials to your account config:
  // channels.wecom.agent.asr = { appId: "...", secretId: "...", secretKey: "..." }
  //
  // Or pass them directly via asrConfig parameter.

  // Try to get ASR config from account config first
  const accountAsrConfig = (account.config as any).asr as TencentFlashASRConfig | undefined;

  if (!accountAsrConfig && !asrConfig) {
    throw new Error(
      "ASR credentials not configured. " +
      "Add ASR config to channels.wecom.agent.asr or pass asrConfig parameter."
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

  // Validate required fields
  if (!config.appId || !config.secretId || !config.secretKey) {
    throw new Error(
      "ASR credentials incomplete. Required: appId, secretId, secretKey. " +
      "These are Tencent Cloud ASR credentials, NOT WeCom credentials."
    );
  }

  try {
    const transcript = await transcribeTencentFlash({
      audio: audioBuffer,
      config,
    });
    return transcript;
  } catch (error) {
    console.error("[wecom-agent] Voice ASR failed:", error);
    throw error;
  }
}

/**
 * Check if voice message should be transcribed
 * @param account - Agent account configuration
 * @returns true if ASR is enabled
 */
export function isVoiceAsrEnabled(account: ResolvedAgentAccount): boolean {
  const asrConfig = (account.config as any).asr as TencentFlashASRConfig | undefined;
  return Boolean(
    asrConfig?.appId &&
    asrConfig?.secretId &&
    asrConfig?.secretKey
  );
}
