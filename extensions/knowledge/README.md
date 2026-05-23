# OpenClaw Knowledge

> OpenClaw Knowledge Base RAG 引擎 — 独立的 Embedding、向量存储、混合检索、多类型分块（文档/FAQ/对话）插件。

面向 OpenClaw 渠道插件（wecom/lark/dingtalk/qqbot/weixin）提供即插即用的知识库 RAG 能力。每个渠道只需 **~10 行胶水代码**即可集成。

---

## 特性

- **多 Embedding Provider** — OpenAI / DashScope / 智谱 / 千帆 / Ollama
- **多向量后端** — sqlite-vec（生产推荐）/ ZVec（零依赖）/ ZVec-Native
- **混合检索** — 向量相似度 + FTS5 关键词搜索，可调比例
- **多类型分块** — document（标题树） / FAQ（QA 双通道） / conversation（滑动窗口）
- **重排序** — Jina / 智谱 / Ollama
- **文档解析** — Ollama / 智谱
- **Token 化** — tiktoken / 智谱
- **意图门控** — rule（0ms 快速决策） / strict（严格模式）
- **CRUD 工具** — `knowledge_add` / `knowledge_query` / `knowledge_update` / `knowledge_delete`
- **配置层级** — 全局配置 → 按 account 覆盖（扁平化，支持任意字段覆盖）

---

## 快速开始

### 安装

```bash
npm install @partme.ai/openclaw-knowledge
```

### 集成到渠道插件

```typescript
import {
  registerKnowledgeHooks,
  createKnowledgeAddTool,
  createKnowledgeQueryTool,
  createKnowledgeUpdateTool,
  createKnowledgeDeleteTool,
} from '@partme.ai/openclaw-knowledge';

export function onRegister(api: PluginApi) {
  registerKnowledgeHooks(api, 'channels.wecom.knowledge');
  api.registerTool(createKnowledgeAddTool);
  api.registerTool(createKnowledgeQueryTool);
  api.registerTool(createKnowledgeUpdateTool);
  api.registerTool(createKnowledgeDeleteTool);
}
```

### 最小配置

```json
{
  "channels": {
    "wecom": {
      "knowledge": {
        "enabled": true,
        "embedding": { "model": "text-embedding-3-small" },
        "store": { "provider": "zvec" }
      }
    }
  }
}
```

详细配置见 [INSTALL.md](INSTALL.md)。

---

## 架构概览

```
用户输入
    │
    ▼
IntentGate (rule/strict) ─── 非检索意图 → 跳过
    │
    ▼ (检索意图)
Embedding ─── Tokenizer ─── Chunker
    │                                    ┌─────────────┐
    ▼                                    │  Reranker    │
VectorStore ─── HybridRetriever ───►─────┤ (可选)       │
    │                                    │ jina/zhipu/  │
    ▼                                    │ ollama       │
before_prompt_build hook                  └─────────────┘
    │
    ▼
Injection → AI Response
```

三层架构：

1. **knowledge-core** — Agent 自身记忆（正交）
2. **knowledge-wiki** — Agent 编译的结构化记忆（正交）
3. **openclaw-knowledge** — 用户外部文档 RAG（本插件）

三者共存，互不干扰。

---

## 配置架构

- 全局配置：`channels.{channel}.knowledge.*`
- 按 account 覆盖：`channels.{channel}.accounts.{id}.knowledge.*`
- 覆盖策略：仅覆盖指定字段，未指定的从全局继承
- 注意：`enabled` 仅全局生效；`store.sources` 整体替换而非合并

---

## 管道节点速览

| 节点 | 配置即启用 | 失败不阻断 | 可选 Provider |
|------|-----------|-----------|---------------|
| Embedding | ✅ | ✅ | openai / dashscope / zhipu / qianfan / ollama |
| Tokenizer | ✅ | ✅ | tiktoken / zhipu |
| Chunker | ✅ | ✅ | 内置（3 种策略） |
| VectorStore | ✅ | ✅ | sqlite-vec / zvec / zvec-native |
| HybridRetriever | ✅ | ✅ | 内置（alpha 可调） |
| Reranker | ⬜ | ✅ | jina / zhipu / ollama |
| Parser | ⬜ | ✅ | ollama / zhipu |
| IntentGate | ✅ | ✅ | rule / strict |

> ✅ = 默认启用 / ⬜ = 配置后才启用 / 失败不阻断 = 某个节点失败不影响其他节点

---

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 测试（107 个测试）
pnpm test

# 类型检查
pnpm typecheck
```

---

## 发布

```bash
# 打 Tag 触发 CI/CD
git tag v0.1.0
git push --tags
```

自动发布到 npmjs + GitHub Packages。

---

## 文档

- [安装与配置指南](INSTALL.md)
- [架构与策略文档](../../docs/knowledge/OpenClaw-Knowledge-RAG-Strategy_CN.md)
- [配置与使用指南](../../docs/knowledge/OpenClaw-Knowledge-RAG-Guide_CN.md)
