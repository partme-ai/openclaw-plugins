import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OllamaDocParserService } from './ollama.js';
import { ZhipuDocParserService } from './zhipu.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('文档 Parser 输入边界', () => {
  it('智谱 Parser 会把已授权的本地文件转换为远端可访问的 base64 data URL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'knowledge-parser-'));
    temporaryDirectories.push(directory);
    const file = join(directory, 'fixture.png');
    await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      md_results: '# fixture',
      layout_details: [],
      data_info: { num_pages: 1 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new ZhipuDocParserService({ provider: 'zhipu', apiKey: 'test-key' }).parse(file);

    expect(result.text).toBe('# fixture');
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { file: string };
    expect(body.file).toBe('data:image/png;base64,iVBORw==');
  });

  it('智谱 Parser 拒绝明文远程 URL 与伪造 data URL', async () => {
    const parser = new ZhipuDocParserService({ provider: 'zhipu', apiKey: 'test-key' });
    await expect(parser.parse('http://example.com/document.png')).rejects.toThrow('only accepts HTTPS');
    await expect(parser.parse('data:image/png,not-base64')).rejects.toThrow('base64 data URL');
  });

  it('Ollama Parser 拒绝非 base64 data URL 与未渲染 PDF', async () => {
    const parser = new OllamaDocParserService({ provider: 'ollama' });
    await expect(parser.parse('data:image/png,not-base64')).rejects.toThrow('valid base64 data URL');
    await expect(parser.parse('/owner/docs/source.pdf')).rejects.toThrow('does not accept PDF directly');
  });
});
