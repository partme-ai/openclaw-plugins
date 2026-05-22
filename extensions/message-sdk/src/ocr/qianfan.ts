/**
 * 百度千帆 OCR
 *
 * 基于百度千帆大模型平台的 OCR 识别。
 * 参考：spring-ai-examples/spring-ai-ollama-ocr-qianfan
 */

import {
  OCRTimeoutError, OCRAuthError, OCRRequestError, OCRResponseParseError, OCRServiceError, OCREmptyResultError,
} from "./errors.js";
import type { OCRInput, OCRConfig, OCRResult, OCRBlock } from "./types.js";

const PROVIDER = "qianfan";
const DEFAULT_MODEL = "ernie-4.0-turbo-8k";
const DEFAULT_BASE_URL = "https://qianfan.baidubce.com/v2";

async function getAccessToken(apiKey: string, secretKey: string): Promise<string> {
  const resp = await fetch(
    `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`,
    { method: "POST" },
  );
  if (!resp.ok) throw new OCRAuthError(PROVIDER, `Failed to get Baidu access token: HTTP ${resp.status}`, resp.status);
  const data = await resp.json() as { access_token?: string; error_description?: string };
  if (!data.access_token) throw new OCRAuthError(PROVIDER, data.error_description ?? "No access_token in response");
  return data.access_token;
}

/**
 * recognizeQianfan 是 ocr 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export async function recognizeQianfan(input: OCRInput, config: OCRConfig): Promise<OCRResult> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();

  try {
    // 百度千帆使用 IAM 鉴权：apiKey = client_id, secretKey 需要单独传
    // 如果 config 中有 secretKey，则用 OAuth 获取 token
    const apiKey = config.apiKey;
    const token = apiKey; // 简化版：直接用 apiKey 作为 access_token

    const imageData = input.base64
      ? input.base64
      : input.url
        ? input.url
        : (() => { throw new OCRRequestError(PROVIDER, "No image data"); })();

    const isUrl = /^https?:\/\//i.test(imageData);

    const messages = [{
      role: "user" as const,
      content: [
        { type: "text" as const, text: "请识别这张图片中的所有文字，逐行输出完整的文字内容。" },
        isUrl
          ? { type: "image_url" as const, image_url: { url: imageData } }
          : { type: "image_url" as const, image_url: { url: `data:${input.mimeType ?? "image/png"};base64,${imageData}` } },
      ],
    }];

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model, messages, max_tokens: 2000, temperature: 0 }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      if (resp.status === 401 || resp.status === 403) throw new OCRAuthError(PROVIDER, `Qianfan auth failed: ${errText}`, resp.status);
      throw new OCRRequestError(PROVIDER, `Qianfan request failed: HTTP ${resp.status} ${errText}`, resp.status);
    }

    const data = await resp.json().catch(() => { throw new OCRResponseParseError(PROVIDER, "Invalid JSON"); }) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new OCREmptyResultError(PROVIDER);

    const block: OCRBlock = { text, confidence: 0.9, lines: [] };
    return { text, blocks: [block], provider: PROVIDER, model, elapsedMs: Date.now() - startMs };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new OCRTimeoutError(PROVIDER, timeoutMs);
    throw err;
  } finally { clearTimeout(timeoutId); }
}
