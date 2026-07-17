# OpenClaw Knowledge

适配 OpenClaw `2026.7.1` 的本地知识库 RAG 插件。插件注册 `before_prompt_build` 自动检索钩子，以及 `knowledge_add`、`knowledge_query`、`knowledge_update`、`knowledge_delete` 四个工具。

同一 `sourceId` 的重建使用存储层原子替换，并对并发写入按调用顺序串行；SQLite 会在同一事务中更新向量与 FTS，失败时保留旧文档。

## 当前能力边界

- Embedding：OpenAI-compatible、DashScope、智谱、千帆、Ollama。
- 存储：`sqlite-vec`（默认，Node.js 内置 SQLite + FTS5）和 `zvec`（纯 JavaScript，小规模/开发用途，可选 JSON 持久化）。
- 检索：vector、keyword、hybrid；hybrid 默认权重为 0.7/0.3，可选智谱或 Jina Reranker。
- 文档解析：可选智谱 Layout Parsing 或 Ollama 视觉模型。智谱支持 PDF/PNG/JPEG；Ollama
  的 `images` 输入仅接收图片，PDF 必须先逐页渲染或改用智谱。
- 注入：按块数及 token/字符上限约束，可注入 system 或 user prompt。
- 隔离：默认 namespace 由 OpenClaw `sessionKey` 的 SHA-256 摘要派生；Hook 与 Tool 使用同一解析器，非 owner 不能跨 namespace。
- 文件摄取：默认关闭；仅 owner 可用，并且文件 realpath 必须位于允许根目录内。

本插件当前不承诺远程 URL 抓取、外部向量数据库或多节点共享索引。PDF/Office/图片等格式必须显式配置 `parser.provider`，并在真实 Provider 环境验收。

## 安装与配置

```bash
openclaw plugins install @partme.ai/openclaw-knowledge@2026.7.1
```

在 OpenClaw 配置中启用：

```json
{
  "plugins": {
    "entries": {
      "knowledge": {
        "enabled": true,
        "config": {
          "enabled": true,
          "embedding": {
            "provider": "openai",
            "model": "text-embedding-3-small",
            "dimensions": 1536
          },
          "store": {
            "provider": "sqlite-vec",
            "dbPath": "./data/knowledge.db"
          },
          "retrieval": {
            "strategy": "hybrid",
            "topK": 5,
            "minScore": 0.3,
            "vectorWeight": 0.7,
            "keywordWeight": 0.3
          },
          "injection": {
            "position": "system",
            "maxChunks": 5,
            "maxTokens": 2048,
            "template": "以下是相关知识库内容，请据此回答用户问题：\n\n{context}"
          },
          "tools": {
            "allowFileIngest": false,
            "allowedFileRoots": [],
            "maxFileBytes": 10485760,
            "maxInputChars": 100000,
            "allowOwnerGlobalNamespaces": true
          }
        }
      }
    }
  }
}
```

OpenAI-compatible 模式默认读取 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `OPENAI_EMBEDDING_MODEL`。不要把密钥提交到仓库。

启用文件摄取时必须同时配置：

```json
{
  "tools": {
    "allowFileIngest": true,
    "allowedFileRoots": ["./knowledge-docs"],
    "maxFileBytes": 10485760
  }
}
```

纯文本支持 `.md`、`.txt`、`.text`、`.csv`、`.json`；其它格式需配置 Parser。符号链接越界会被拒绝。

## 数据与升级说明

- SQLite 使用同一数据库内的 namespace 专属表，表名包含稳定哈希，避免 `a:b` 与 `a_b` 碰撞。
- `zvec` 配置 `dbPath` 后会为每个 namespace 派生独立哈希文件，并在关闭时原子落盘。
- 早期版本对 namespace 的清洗可能产生碰撞。升级到 2026.7.1 后，含标点或大写字符的旧 namespace 表不会自动迁移；请从可信源重新索引，避免把历史碰撞数据复制到错误租户。
- 旧 `accountId:mode` 数据不会自动复制到新的会话摘要 namespace；这是有意的跨租户安全边界，应从可信源重新索引。
- 更换 embedding 模型或 dimensions 后应重新索引已有内容。
- `embedding.requestTimeoutMs`、`embedding.maxRetries`、`embedding.maxBatchSize` 分别控制外部请求超时、瞬时错误重试和单批规模；默认值为 30000、2、64。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
```

详细设计和运维边界见 [`../../doc/knowledge`](../../doc/knowledge)。
