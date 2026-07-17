/**
 * @fileoverview 智谱 GLM-OCR layout_parsing — 远程 PDF/图像解析。
 *
 * **模块角色**：Knowledge Plugin · Parser provider (Zhipu)。
 *
 * @module knowledge/parser/zhipu
 */
import type { DocParserService, KnowledgeParserConfig, ParsedDocument } from '../types.js';
import { readFile } from 'node:fs/promises';
import { requestProviderJson } from '../shared/provider-http.js';

/** 默认模型 */
const DEFAULT_MODEL = 'glm-ocr';
/** 智谱 Layout Parsing API 端点 */
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/layout_parsing';

/**
 * 智谱 Layout Parsing 远程文档解析器。
 *
 * 将文件引用提交给外部 OCR 服务，使用统一有界 HTTP 客户端控制超时、重试和
 * 响应体；对 Markdown、页数、布局元素及边界框做防御性解析后再交给切块器。
 */
export class ZhipuDocParserService implements DocParserService {
  readonly modelName: string;
  private baseUrl: string;
  private apiKey: string;
  private config?: KnowledgeParserConfig;

  constructor(config?: KnowledgeParserConfig) {
    this.config = config;
    this.baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config?.apiKey ?? '';
    this.modelName = config?.model ?? DEFAULT_MODEL;
  }

  async parse(file: string): Promise<ParsedDocument> {
    if (!this.apiKey) {
      throw new Error('Zhipu DocParser requires apiKey');
    }

    const providerFile = await this.prepareProviderFile(file);
    const body: Record<string, unknown> = {
      model: this.modelName,
      file: providerFile,
    };

    const data = await requestProviderJson<Record<string, unknown>>(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    }, {
      timeoutMs: this.config?.requestTimeoutMs,
      maxRetries: this.config?.maxRetries,
      maxResponseBytes: this.config?.maxResponseBytes ?? 16 * 1024 * 1024,
    }, 'Zhipu', 'DocParser');
    if (typeof data.md_results !== 'string' || !data.md_results.trim()) {
      throw new Error('Zhipu DocParser returned empty or invalid markdown');
    }
    const dataInfo = data.data_info && typeof data.data_info === 'object'
      ? data.data_info as { num_pages?: unknown }
      : undefined;

    const result: ParsedDocument = {
      text: data.md_results,
      metadata: {
        fileName: this.extractFileName(file),
        mimeType: this.detectMimeType(file),
        totalPages: Number.isSafeInteger(dataInfo?.num_pages) ? dataInfo?.num_pages as number : undefined,
      },
    };

    // 解析布局详情（可选）
    if (Array.isArray(data.layout_details)) {
      result.layout = {
        pages: data.layout_details.filter(Array.isArray).map((page) => {
          const elements = page.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
          const first = elements[0];
          return {
          width: typeof first?.width === 'number' ? first.width : 0,
          height: typeof first?.height === 'number' ? first.height : 0,
          elements: elements.filter((element) => typeof element.content === 'string').map((el) => ({
            type: this.mapLabelToType(typeof el.label === 'string' ? el.label : 'text'),
            content: el.content as string,
            bbox: this.validBbox(el.bbox_2d),
          })),
        }; }),
      };
    }

    return result;
  }

  async health(): Promise<boolean> {
    try {
      // 轻量探测：发一个很小的 base64 图片
      const result = await this.parse('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
      return typeof result.text === 'string';
    } catch {
      return false;
    }
  }

  private extractFileName(file: string): string {
    if (file.startsWith('data:')) return 'inline-image';
    try {
      const url = new URL(file);
      return url.pathname.split('/').pop() ?? 'remote-file';
    } catch {
      // 本地路径
      return file.split('/').pop() ?? 'local-file';
    }
  }

  /**
   * 把 owner 已授权的本地文件转换为远端 API 可识别的 data URL。
   *
   * 智谱 `layout_parsing.file` 只接受 URL 或 base64；直接发送本机路径会在开发机上
   * 看似配置成功、到远端却必然无法访问。HTTP URL 也拒绝，以免明文文档地址和查询
   * 参数泄露在链路上；本地文件/data URL 均在出站前执行字节上限。
   */
  private async prepareProviderFile(file: string): Promise<string> {
    if (file.startsWith('data:')) {
      const match = file.match(/^data:(application\/pdf|image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/u);
      if (!match) throw new Error('Zhipu DocParser requires a PDF/PNG/JPEG base64 data URL');
      this.assertFileSize(Buffer.byteLength(match[2], 'base64'));
      return file;
    }
    if (file.startsWith('https://')) return file;
    if (file.startsWith('http://')) {
      throw new Error('Zhipu DocParser only accepts HTTPS remote URLs');
    }

    const mimeType = this.detectMimeType(file);
    if (!mimeType) throw new Error('Zhipu DocParser local file must be PDF, PNG, JPG or JPEG');
    const bytes = await readFile(file);
    this.assertFileSize(bytes.byteLength);
    return `data:${mimeType};base64,${bytes.toString('base64')}`;
  }

  private assertFileSize(bytes: number): void {
    const maximum = this.config?.maxFileBytes ?? 20 * 1024 * 1024;
    if (bytes > maximum) throw new Error(`Zhipu DocParser input ${bytes} bytes exceeds maxFileBytes=${maximum}`);
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

  private mapLabelToType(label: string): 'text' | 'image' | 'table' | 'formula' {
    switch (label) {
      case 'image': return 'image';
      case 'table': return 'table';
      case 'formula': return 'formula';
      default: return 'text';
    }
  }

  private validBbox(value: unknown): [number, number, number, number] {
    return Array.isArray(value) && value.length === 4 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
      ? value as [number, number, number, number]
      : [0, 0, 0, 0];
  }
}
