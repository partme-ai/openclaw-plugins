/**
 * @fileoverview Ollama VLM 文档解析 — 本地 glm-ocr 等视觉模型 OCR。
 *
 * **模块角色**：Knowledge Plugin · Parser provider (Ollama local)。
 *
 * @module knowledge/parser/ollama
 */
import type { DocParserService, KnowledgeParserConfig, ParsedDocument } from '../types.js';
import { readFile } from 'node:fs/promises';
import { requestProviderJson } from '../shared/provider-http.js';

/** 默认模型 — GLM-OCR（0.9B，Ollama 原生） */
const DEFAULT_MODEL = 'glm-ocr';
/** Ollama API 端点 */
const DEFAULT_BASE_URL = 'http://localhost:11434';

/** 默认 OCR 提示词 */
const OCR_PROMPT = 'Convert this document to markdown. Return only the markdown content.';

/**
 * 基于 Ollama 视觉模型的本地文档 OCR 解析器。
 *
 * 只接受受信任的本地文件或 data URL，不主动抓取远程 URL，从入口切断 SSRF；
 * 文件与响应均有大小上限，最终只向索引管道返回非空 Markdown。
 */
export class OllamaDocParserService implements DocParserService {
  readonly modelName: string;
  private baseUrl: string;
  private config?: KnowledgeParserConfig;

  constructor(config?: KnowledgeParserConfig) {
    this.config = config;
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
    const data = await requestProviderJson<{ message?: { content?: unknown } }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, {
      timeoutMs: this.config?.requestTimeoutMs,
      maxRetries: this.config?.maxRetries,
      maxResponseBytes: this.config?.maxResponseBytes ?? 16 * 1024 * 1024,
    }, 'Ollama', 'DocParser');
    const content = data.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Ollama DocParser returned empty or invalid markdown');

    return {
      text: content,
      metadata: {
        fileName: this.extractFileName(file),
        mimeType: this.detectMimeType(file),
      },
    };
  }

  async health(): Promise<boolean> {
    try {
      const url = `${this.baseUrl.replace(/\/+$/, '')}/api/tags`;
      await requestProviderJson(url, { method: 'GET' }, {
        timeoutMs: this.config?.requestTimeoutMs,
        maxRetries: 0,
        maxResponseBytes: 1024 * 1024,
      }, 'Ollama', 'health');
      return true;
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
      if (base64Match) {
        this.assertFileSize(Buffer.byteLength(base64Match[1], 'base64'));
        return base64Match[1];
      }
      throw new Error('Ollama DocParser requires a valid base64 data URL');
    }

    // 远程 URL 会形成 SSRF 边界；要求调用方先下载到 owner 配置的 allowedFileRoots。
    if (file.startsWith('http://') || file.startsWith('https://')) {
      throw new Error('Ollama DocParser does not fetch remote URLs; ingest an owner-approved local file');
    }

    // Ollama Chat 的 images 字段接收图像字节，不接收 PDF 容器；PDF 应改用智谱
    // layout_parsing，或由上游先将页面渲染为图片，避免把无效字节发送到模型后才失败。
    if (/\.pdf$/iu.test(file)) {
      throw new Error('Ollama DocParser does not accept PDF directly; render pages as images or use Zhipu parser');
    }

    // 本地图片路径
    const fileBuffer = await readFile(file);
    this.assertFileSize(fileBuffer.byteLength);
    return fileBuffer.toString('base64');
  }

  private assertFileSize(bytes: number): void {
    const maximum = this.config?.maxFileBytes ?? 20 * 1024 * 1024;
    if (bytes > maximum) throw new Error(`Ollama DocParser input ${bytes} bytes exceeds maxFileBytes=${maximum}`);
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
