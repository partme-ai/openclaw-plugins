/**
 * @fileoverview openmem — OpenMem local-first memory bridge for OpenClaw.
 *
 * @module openmem
 *
 * Implements Memory Host SDK: recall via POST /inspect/search,
 * ingest via POST /events/ingest on agent_end.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'
import type {
  MemorySearchManager,
  MemorySearchResult,
  MemoryProviderStatus,
  MemoryEmbeddingProbeResult,
} from 'openclaw/plugin-sdk/memory-core-host-engine-storage'

/** OpenMem 插件运行时配置。 */
interface OpenMemPluginConfig {
  enabled: boolean
  baseUrl: string
  maxSearchResults: number
}

/** 默认 OpenMem 配置（本地 3317 端口）。 */
const DEFAULTS: OpenMemPluginConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:3317',
  maxSearchResults: 10,
}

/**
 * 合并插件配置与默认值。
 *
 * @param api - OpenClaw 插件 API
 * @returns 解析后的 OpenMem 插件配置
 */
function resolveConfig(api: OpenClawPluginApi): OpenMemPluginConfig {
  const r = (api.pluginConfig ?? {}) as Partial<OpenMemPluginConfig>
  return { ...DEFAULTS, ...r }
}

/**
 * 调用 OpenMem REST API 并解析 JSON 响应。
 *
 * @param baseUrl - OpenMem 服务根 URL
 * @param path - API 路径（如 `/inspect/search`）
 * @param init - 可选 fetch 初始化参数
 * @returns 解析后的 JSON 体
 * @throws 非 2xx 响应时抛出带状态码与 body 摘要的错误
 */
async function apiJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenMem ${res.status}: ${text || res.statusText}`)
  }
  return res.json() as Promise<T>
}

/**
 * Builds MemorySearchManager backed by OpenMem hybrid inspect search.
 *
 * @param baseUrl - OpenMem HTTP 基址（默认 `http://127.0.0.1:3317`）
 * @returns Memory Host SDK 兼容的搜索管理器
 */
export function createOpenMemSearchManager(baseUrl: string): MemorySearchManager {
  return {
    async search(query, opts) {
      const data = await apiJson<{ chunks: Array<{ content: string; score: number; source?: string }> }>(
        baseUrl,
        '/inspect/search',
        {
          method: 'POST',
          body: JSON.stringify({ query, mode: 'hybrid', limit: opts?.maxResults ?? 10 }),
        },
      )
      return (data.chunks ?? []).map(
        (c, i): MemorySearchResult => ({
          path: `openmem/chunk/${i}`,
          startLine: i + 1,
          endLine: i + 1,
          score: c.score,
          snippet: c.content.slice(0, 200),
          source: 'memory',
        }),
      )
    },

    async readFile({ relPath }) {
      return { text: '', path: relPath }
    },

    status(): MemoryProviderStatus {
      return {
        backend: 'builtin',
        provider: 'openmem',
        files: 0,
        sources: ['memory'],
        workspaceDir: baseUrl,
      }
    },

    async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
      return { ok: false, checked: true, checkedAtMs: Date.now() }
    },

    async probeVectorAvailability(): Promise<boolean> {
      return false
    },
  }
}

/** OpenClaw OpenMem 插件定义（HTTP bridge + openmem_search 工具）。 */
const plugin = {
  id: 'openmem',
  name: 'OpenMem',
  kind: 'memory' as const,
  description: 'OpenMem local-first memory — HTTP bridge to OpenMem REST (§6.2)',
  configSchema: { type: 'object' as const, additionalProperties: true, properties: {} },

  /**
   * 注册 Memory runtime、openmem_search 工具与 agent_end 事件 ingest。
   *
   * @param api - OpenClaw 插件 API
   */
  register(api: OpenClawPluginApi) {
    const cfg = resolveConfig(api)
    if (!cfg.enabled) {
      api.logger.info('[openmem] Disabled')
      return
    }

    const manager = createOpenMemSearchManager(cfg.baseUrl)
    api.registerMemoryCapability({
      runtime: {
        async getMemorySearchManager() {
          return { manager }
        },
        resolveMemoryBackendConfig() {
          return { backend: 'builtin' }
        },
      },
    })
    api.logger.info(`[openmem] Memory runtime → ${cfg.baseUrl}`)

    api.registerTool(
      {
        name: 'openmem_search',
        label: 'OpenMem Search',
        description: 'Search externalized memories via OpenMem hybrid recall.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results (default 10)' },
          },
          required: ['query'],
        },
        async execute(_id: string, params: Record<string, unknown>) {
          const results = await manager.search(String(params.query ?? ''), {
            maxResults: Math.min(Math.max(Number(params.limit) || 10, 1), 20),
          })
          const text =
            results.length === 0
              ? 'No OpenMem memories found.'
              : results.map((r, i) => `${i + 1}. ${r.snippet}`).join('\n')
          return { content: [{ type: 'text' as const, text }], details: { count: results.length } }
        },
      },
      { name: 'openmem_search' },
    )

    api.on('agent_end', async (event, ctx) => {
      const e = event as Record<string, unknown>
      const msgs = (Array.isArray(e.messages) ? e.messages : []) as Array<{ role: string; content: string }>
      if (msgs.length === 0 || !e.success) return
      const sessionKey = ctx.sessionKey ?? 'unknown'
      const events = msgs.map((m) => ({
        sessionId: sessionKey,
        type: 'agent_message',
        source: 'runtime',
        content: m.content,
        payload: { role: m.role },
      }))
      try {
        await apiJson(cfg.baseUrl, '/events/ingest', {
          method: 'POST',
          body: JSON.stringify({ events }),
        })
      } catch (err) {
        api.logger.warn(`[openmem] ingest failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })

    api.logger.info('[openmem] Registered — kind=memory, ingest on agent_end')
  },
}

export default plugin
