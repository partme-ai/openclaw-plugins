/**
 * @module agent/asr
 *
 * Agent 模式 **语音转文字**（ASR），复用 message-sdk 腾讯云 Flash ASR。
 *
 * **职责**：
 * - 从 `channels.wecom.agent.asr` 读取凭据
 * - 对入站 voice 消息的 AMR 等音频 Buffer 调用 `transcribeTencentFlash`
 *
 * **上下游**：
 * - 上游：`agent/handler` 下载 voice 媒体后调用
 * - 下游：message-sdk `@partme.ai/openclaw-message-sdk/asr`
 */

import {
  transcribeTencentFlash,
  type TencentFlashASRConfig,
} from "@partme.ai/openclaw-message-sdk/asr";
import type { ResolvedAgentAccount } from "../types/index.js";

/**
 * 将语音 Buffer 转为文本。
 *
 * @param account - Agent 账号（含 asr 配置）
 * @param audioBuffer - 音频二进制（通常为 AMR）
 * @param asrConfig - 可选覆盖配置
 * @returns 识别文本
 */
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

/**
 * 判断当前 Agent 账号是否已配置完整 ASR 凭据。
 *
 * @param account - Agent 账号
 */
export function isVoiceAsrEnabled(account: ResolvedAgentAccount): boolean {
  const asrConfig = (account.config as { asr?: TencentFlashASRConfig }).asr;
  return Boolean(asrConfig?.appId && asrConfig?.secretId && asrConfig?.secretKey);
}

export type { TencentFlashASRConfig };
