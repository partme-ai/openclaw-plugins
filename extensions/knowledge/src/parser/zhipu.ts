/**
 * ZhipuDocParserService — 智谱 AI GLM-OCR 文档解析实现（远程方案）
 *
 * 调用智谱 AI 的 layout_parsing API，使用 GLM-OCR 模型解析文档和图片的布局
 * 并提取文本内容。支持图片和 PDF 文档的 OCR 识别，返回 Markdown 格式结果和布局详情。
 *
 * API: POST https://open.bigmodel.cn/api/paas/v4/layout_parsing
 * 文档: https://docs.bigmodel.cn/api-reference/模型-api/文档解析
 */
import type { DocParserService, KnowledgeParserConfig, ParsedDocument } from '../types.js';

/** 默认模型 */
const DEFAULT_MODEL = 'glm-ocr';
/** 智谱 Layout Parsing API 端点 */
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/layout_parsing';

export class ZhipuDocParserService implements DocParserService {
  readonly modelName: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(config?: KnowledgeParserConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config?.apiKey ?? '';
    this.modelName = config?.model ?? DEFAULT_MODEL;
  }

  async parse(file: string): Promise<ParsedDocument> {
    if (!this.apiKey) {
      throw new Error('Zhipu DocParser requires apiKey');
    }

    const body: Record<string, unknown> = {
      model: this.modelName,
      file,
    };

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`Zhipu DocParser API error: ${response.status} — ${errorText}`);
    }

    const data = (await response.json()) as {
      model: string;
      md_results?: string;
      data_info?: { num_pages: number };
      layout_details?: {
        index: number;
        label: string;
        content: string;
        bbox_2d: [number, number, number, number];
        height: number;
        width: number;
      }[][];
    };

    const result: ParsedDocument = {
      text: data.md_results ?? '',
      metadata: {
        fileName: this.extractFileName(file),
        mimeType: this.detectMimeType(file),
        totalPages: data.data_info?.num_pages,
      },
    };

    // 解析布局详情（可选）
    if (data.layout_details) {
      result.layout = {
        pages: data.layout_details.map((page) => ({
          width: page[0]?.width ?? 0,
          height: page[0]?.height ?? 0,
          elements: page.map((el) => ({
            type: this.mapLabelToType(el.label),
            content: el.content,
            bbox: el.bbox_2d,
          })),
        })),
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
}
