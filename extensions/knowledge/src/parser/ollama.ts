/**
 * @fileoverview Ollama VLM 文档解析 — 本地 glm-ocr 等视觉模型 OCR。
 *
 * **模块角色**：Knowledge Plugin · Parser provider (Ollama local)。
 *
 * @module knowledge/parser/ollama
 */
import type { DocParserService, KnowledgeParserConfig, ParsedDocument } from '../types.js';
import { readFileSync } from 'node:fs';

/** 默认模型 — GLM-OCR（0.9B，Ollama 原生） */
const DEFAULT_MODEL = 'glm-ocr';
/** Ollama API 端点 */
const DEFAULT_BASE_URL = 'http://localhost:11434';

/** 默认 OCR 提示词 */
const OCR_PROMPT = 'Convert this document to markdown. Return only the markdown content.';

export class OllamaDocParserService implements DocParserService {
  readonly modelName: string;
  private baseUrl: string;

  constructor(config?: KnowledgeParserConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
    this.modelName = config?.model ?? DEFAULT_MODEL;
  }

  async parse(file: string): Promise<ParsedDocument> {
    const imageBase64 = await this.loadImageAsBase64(file);

    const body = {
      model: this.modelName,
      messages: [
        {
          role: 'user' as const,
          content: OCR_PROMPT,
          images: [imageBase64],
        },
      ],
      stream: false,
    };

    const url = `${this.baseUrl.replace(/\/+$/, '')}/api/chat`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`Ollama DocParser error: ${response.status} — ${errorText}`);
    }

    const data = (await response.json()) as {
      message?: { content: string };
      done?: boolean;
    };

    return {
      text: data.message?.content ?? '',
      metadata: {
        fileName: this.extractFileName(file),
        mimeType: this.detectMimeType(file),
      },
    };
  }

  async health(): Promise<boolean> {
    try {
      const url = `${this.baseUrl.replace(/\/+$/, '')}/api/tags`;
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 将文件路径或 base64 数据加载为 base64 字符串
   */
  private async loadImageAsBase64(file: string): Promise<string> {
    // 已经是 base64 data URL
    if (file.startsWith('data:')) {
      // 提取 base64 部分（去掉 data:image/...;base64, 前缀）
      const base64Match = file.match(/^data:[^;]+;base64,(.+)$/);
      if (base64Match) return base64Match[1];
      return file;
    }

    // HTTP/HTTPS URL — 下载后转 base64
    if (file.startsWith('http://') || file.startsWith('https://')) {
      const response = await fetch(file);
      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer).toString('base64');
    }

    // 本地文件路径
    const fileBuffer = readFileSync(file);
    return fileBuffer.toString('base64');
  }

  private extractFileName(file: string): string {
    if (file.startsWith('data:')) return 'inline-image';
    try {
      const url = new URL(file);
      return url.pathname.split('/').pop() ?? 'remote-file';
    } catch {
      return file.split('/').pop() ?? 'local-file';
    }
  }

  private detectMimeType(file: string): string | undefined {
    if (file.startsWith('data:')) {
      const match = file.match(/^data:([^;]+);/);
      return match?.[1];
    }
    if (file.match(/\.(pdf|PDF)$/)) return 'application/pdf';
    if (file.match(/\.(png|PNG)$/)) return 'image/png';
    if (file.match(/\.(jpg|jpeg|JPG|JPEG)$/)) return 'image/jpeg';
    return undefined;
  }
}
