/**
 * openmem plugin — MemorySearchManager and HTTP bridge tests (mock fetch).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenMemSearchManager } from './index.js'

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
})
