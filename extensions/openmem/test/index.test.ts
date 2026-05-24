/**
 * openmem plugin — MemorySearchManager and HTTP bridge tests (mock fetch).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenMemSearchManager } from '../src/index.js'

describe('createOpenMemSearchManager', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('search calls POST /inspect/search and maps chunks', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => ({
        chunks: [{ content: 'OpenMem JSONL storage', score: 0.88, source: 'memory:abc' }],
      }),
    } as Response)

    const manager = createOpenMemSearchManager('http://127.0.0.1:3317')
    const results = await manager.search('JSONL', { maxResults: 5 })

    expect(results).toHaveLength(1)
    expect(results[0].snippet).toContain('JSONL')
    expect(results[0].score).toBe(0.88)
    expect(results[0].source).toBe('memory')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://127.0.0.1:3317/inspect/search')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(String(init?.body))
    expect(body.query).toBe('JSONL')
    expect(body.mode).toBe('hybrid')
  })

  it('search throws when API returns error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
      text: async () => 'down',
    } as Response)

    const manager = createOpenMemSearchManager('http://127.0.0.1:3317')
    await expect(manager.search('test')).rejects.toThrow(/OpenMem 503/)
  })

  it('search returns empty array when no chunks', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chunks: [] }),
    } as Response)

    const manager = createOpenMemSearchManager('http://127.0.0.1:3317/')
    const results = await manager.search('missing')
    expect(results).toEqual([])
  })

  it('status reports OpenMem provider', () => {
    const manager = createOpenMemSearchManager('http://localhost:3317')
    const st = manager.status()
    expect(st.provider).toBe('openmem')
    expect(st.backend).toBe('builtin')
    expect(st.sources).toContain('memory')
  })

  it('probeEmbeddingAvailability returns not ok', async () => {
    const manager = createOpenMemSearchManager('http://127.0.0.1:3317')
    const probe = await manager.probeEmbeddingAvailability()
    expect(probe.ok).toBe(false)
    expect(probe.checked).toBe(true)
  })

  it('probeVectorAvailability returns false', async () => {
    const manager = createOpenMemSearchManager('http://127.0.0.1:3317')
    expect(await manager.probeVectorAvailability()).toBe(false)
  })

  it('search honors maxResults option', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chunks: [] }),
    } as Response)

    const manager = createOpenMemSearchManager('http://127.0.0.1:3317')
    await manager.search('q', { maxResults: 3 })

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    expect(body.limit).toBe(3)
  })

  it('search truncates snippet to 200 characters', async () => {
    const long = 'x'.repeat(300)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chunks: [{ content: long, score: 0.5 }] }),
    } as Response)

    const manager = createOpenMemSearchManager('http://127.0.0.1:3317')
    const results = await manager.search('x')
    expect(results[0].snippet).toHaveLength(200)
  })

  it('search maps chunk metadata to MemorySearchResult shape', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chunks: [{ content: 'payload', score: 0.42, source: 'memory:xyz' }],
      }),
    } as Response)

    const manager = createOpenMemSearchManager('http://127.0.0.1:3317')
    const results = await manager.search('payload')
    expect(results[0]).toMatchObject({
      path: 'openmem/chunk/0',
      startLine: 1,
      endLine: 1,
      score: 0.42,
      source: 'memory',
    })
  })

  it('readFile returns empty text placeholder', async () => {
    const manager = createOpenMemSearchManager('http://127.0.0.1:3317')
    const file = await manager.readFile({ relPath: 'records/a.jsonl' })
    expect(file).toEqual({ text: '', path: 'records/a.jsonl' })
  })

  it('status uses baseUrl as workspaceDir', () => {
    const manager = createOpenMemSearchManager('http://mem.local:3317/')
    expect(manager.status().workspaceDir).toBe('http://mem.local:3317/')
  })

  it('normalizes trailing slash on baseUrl for API calls', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chunks: [] }),
    } as Response)

    const manager = createOpenMemSearchManager('http://127.0.0.1:3317/')
    await manager.search('ping')

    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      'http://127.0.0.1:3317/inspect/search',
    )
  })

  it('search throws with statusText when error body empty', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => '',
    } as Response)

    const manager = createOpenMemSearchManager('http://127.0.0.1:3317')
    await expect(manager.search('fail')).rejects.toThrow(/OpenMem 502/)
  })

  it('probeEmbeddingAvailability includes checkedAtMs timestamp', async () => {
    const manager = createOpenMemSearchManager('http://127.0.0.1:3317')
    const probe = await manager.probeEmbeddingAvailability()
    expect(typeof probe.checkedAtMs).toBe('number')
  })
})
