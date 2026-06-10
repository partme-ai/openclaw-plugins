# 🕸️ openclaw-memory-graph 开发方案

> **项目名：** `memory-graph`
> **定位：** OpenClaw 记忆图谱插件——从对话中自动提取实体与关系，构建本地知识图谱，支持图遍历召回

> memory-graph 是 OpenClaw 的记忆图谱插件，用于从对话中自动提取实体与关系，构建本地知识图谱，支持图遍历召回和关系查询。

---

## 一、产品定位

### 核心价值

现有 OpenClaw 记忆系统以**文本块 + 向量搜索**为主，擅长语义检索但不擅长**关系推理**：

- ❌ "谁负责什么模块？"——需要翻很多笔记拼凑
- ❌ "A 和 B 的决策有什么关联？"——无法自动推理因果链
- ❌ "这个项目经历了哪些架构变迁？"——缺少时序追踪

**openclaw-memory-graph** 解决这个问题：

> 从对话和记忆文件中自动提取 **Entity（实体）→ Relation（关系）→ Entity（实体）** 三元组，存储为本地知识图谱，支持图遍历召回和关系查询。

### 与现有模块的关系

```
┌─────────────────────────────────────────────────┐
│            memory-core / LanceDB / QMD          │  文本搜索
├─────────────────────────────────────────────────┤
│            memory-wiki                          │  结构化知识（声明/证据）
├─────────────────────────────────────────────────┤
│           ★ memory-graph ★                      │  实体关系图谱
│        自动三元组提取 + 图遍历 + 时序追踪           │
├─────────────────────────────────────────────────┤
│            active-memory                        │  主动召回（可查询 graph）
└─────────────────────────────────────────────────┘
```

**不替代** memory-core 或 memory-wiki，是**并行的图关系层**。

---

## 二、技术架构

### 集成方式选择

根据 OpenClaw Plugin SDK，有**两种集成路径**：

| 方案 | 注册方式 | 优势 | 劣势 |
|------|----------|------|------|
| **A. Context Engine** | `plugins.slots.contextEngine` | 可控制消息摄入、上下文组装、自动提取三元组 | 独占 contextEngine slot |
| **B. Tool + Hook Plugin** | `api.registerTool()` + `api.registerHook()` | 与其他 context engine 共存，更轻量 | 需要靠 hook 拦截消息 |

**推荐：方案 B（Tool + Hook Plugin）**

理由：
1. 不抢占 `contextEngine` slot，与 lossless-claw 等共存
2. 用 `afterTurn` hook 自动提取三元组，不阻塞主回复路径
3. 注册独立的图工具，Agent 可主动调用
4. 可注册 `memoryCorpusSupplement` 让 memory_search 也能搜图谱内容

### 数据模型

```typescript
// 实体（Entity / Node）
interface GraphEntity {
  id: string;                  // 唯一标识 "entity.<type>.<name>"
  type: string;                // person | project | module | concept | decision | ...
  name: string;                // 显示名
  aliases: string[];           // 别名
  properties: Record<string, unknown>;  // 附加属性
  confidence: number;          // 0-1 置信度
  sourceIds: string[];         // 来源消息/文件
  firstSeen: string;           // ISO 时间
  lastSeen: string;            // ISO 时间
  embedding?: number[];        // 可选：向量（用于语义搜索）
}

// 关系（Relation / Edge）
interface GraphRelation {
  id: string;                  // 唯一标识 "rel.<fromId>.<predicate>.<toId>"
  fromEntityId: string;        // 起始实体
  predicate: string;           // 关系类型：manages | depends_on | created | decided | ...
  toEntityId: string;          // 目标实体
  properties: Record<string, unknown>;
  confidence: number;
  sourceIds: string[];
  temporal: {
    validFrom?: string;        // 关系生效时间
    validTo?: string;          // 关系失效时间（支持时序追踪）
  };
  firstSeen: string;
  lastSeen: string;
}

// 三元组（提取结果）
interface Triple {
  subject: string;             // 实体名
  predicate: string;           // 关系
  object: string;              // 实体名
  confidence: number;
  source: string;              // 来源
}
```

### 存储层

**SQLite + FTS5**（零外部依赖，与 OpenClaw 生态一致）

```sql
-- 实体表
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT,          -- JSON array
  properties TEXT,       -- JSON object
  confidence REAL DEFAULT 0.5,
  source_ids TEXT,       -- JSON array
  first_seen TEXT,
  last_seen TEXT,
  embedding BLOB         -- 可选：向量
);

-- 关系表
CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  from_entity_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  properties TEXT,       -- JSON object
  confidence REAL DEFAULT 0.5,
  source_ids TEXT,       -- JSON array
  valid_from TEXT,
  valid_to TEXT,
  first_seen TEXT,
  last_seen TEXT,
  FOREIGN KEY (from_entity_id) REFERENCES entities(id),
  FOREIGN KEY (to_entity_id) REFERENCES entities(id)
);

-- 索引
CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_relations_from ON relations(from_entity_id);
CREATE INDEX idx_relations_to ON relations(to_entity_id);
CREATE INDEX idx_relations_predicate ON relations(predicate);

-- FTS5 全文搜索
CREATE VIRTUAL TABLE entities_fts USING fts5(name, aliases, type, content=entities, content_rowid=rowid);
```

---

## 三、目录结构

```
openclaw-memory-graph/
├── package.json
├── openclaw.plugin.json       # 插件清单
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts               # 入口：注册插件
│   ├── graph-engine.ts        # 核心图谱引擎
│   ├── extractor.ts           # 三元组提取器（LLM 驱动）
│   ├── storage.ts             # SQLite 存储层
│   ├── search.ts              # 图搜索 + FTS + 向量混合
│   ├── tools/
│   │   ├── graph_search.ts    # 图搜索工具
│   │   ├── graph_add.ts       # 手动添加实体/关系
│   │   ├── graph_get.ts       # 查询实体详情
│   │   ├── graph_query.ts     # 图遍历查询（路径、邻居）
│   │   ├── graph_timeline.ts  # 时序查询
│   │   └── graph_visualize.ts # 可视化输出（Mermaid/JSON）
│   ├── hooks/
│   │   └── after-turn.ts      # afterTurn hook：自动提取三元组
│   ├── corpus-supplement.ts   # memoryCorpusSupplement 适配器
│   └── utils/
│       ├── id.ts              # ID 生成
│       ├── merge.ts           # 实体合并/去重
│       └── confidence.ts      # 置信度计算
├── test/
│   ├── graph-engine.test.ts
│   ├── extractor.test.ts
│   ├── storage.test.ts
│   └── search.test.ts
└── README.md
```

---

## 四、插件清单

```json
{
  "id": "openclaw-memory-graph",
  "name": "Memory Graph",
  "description": "Knowledge graph memory plugin — auto-extracts entities and relations from conversations, supports graph traversal recall and temporal tracking",
  "version": "1.0.0",
  "contracts": {
    "tools": [
      "graph_search",
      "graph_add",
      "graph_get",
      "graph_query",
      "graph_timeline",
      "graph_visualize"
    ],
    "hooks": ["afterTurn"],
    "memoryCorpusSupplements": true
  },
  "activation": {
    "onStartup": true
  },
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "dbPath": {
        "type": "string",
        "description": "SQLite database path (default: ~/.openclaw/memory/graph/<agentId>.sqlite)",
        "default": ""
      },
      "autoExtract": {
        "type": "boolean",
        "description": "Auto-extract triples from conversations after each turn",
        "default": true
      },
      "extractionModel": {
        "type": "string",
        "description": "Model for triple extraction (default: session model)",
        "default": ""
      },
      "extractionFrequency": {
        "type": "string",
        "enum": ["every_turn", "every_n_turns", "on_compact"],
        "description": "How often to extract triples",
        "default": "every_n_turns"
      },
      "extractionInterval": {
        "type": "integer",
        "description": "Extract every N turns (when frequency is every_n_turns)",
        "default": 3
      },
      "maxTriplesPerTurn": {
        "type": "integer",
        "description": "Max triples to extract per turn",
        "default": 10
      },
      "minConfidence": {
        "type": "number",
        "description": "Minimum confidence to store (0-1)",
        "default": 0.5
      },
      "enableTimeline": {
        "type": "boolean",
        "description": "Enable temporal tracking on relations",
        "default": true
      },
      "enableEmbedding": {
        "type": "boolean",
        "description": "Enable vector embedding for semantic entity search",
        "default": false
      },
      "embeddingProvider": {
        "type": "string",
        "description": "Embedding provider id (e.g. openai, ollama, zhipu)",
        "default": "openai"
      },
      "entityTypes": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Entity types to track (empty = all)",
        "default": []
      },
      "relationTypes": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Relation types to track (empty = all)",
        "default": []
      }
    }
  }
}
```

---

## 五、核心实现

### 5.1 入口文件（index.ts）

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { GraphEngine } from "./graph-engine";
import { registerTools } from "./tools";
import { registerAfterTurnHook } from "./hooks/after-turn";
import { registerCorpusSupplement } from "./corpus-supplement";

export default definePluginEntry({
  id: "openclaw-memory-graph",
  name: "Memory Graph",

  register(api, ctx) {
    const engine = new GraphEngine(ctx.config);

    // 注册工具
    registerTools(api, engine);

    // 注册 afterTurn hook（自动提取三元组）
    if (ctx.config.autoExtract !== false) {
      registerAfterTurnHook(api, engine, ctx.config);
    }

    // 注册 memory corpus supplement（让 memory_search 也能搜图谱）
    registerCorpusSupplement(api, engine);
  },
});
```

### 5.2 三元组提取器（extractor.ts）

**核心逻辑：** 用 LLM 从对话内容中提取结构化三元组。

```typescript
interface ExtractionResult {
  triples: Triple[];
  entities: { name: string; type: string }[];
}

export class TripleExtractor {
  constructor(private config: ExtractorConfig) {}

  async extractFromMessages(messages: Message[]): Promise<ExtractionResult> {
    // 1. 拼接最近 N 轮对话
    const context = this.buildContext(messages);

    // 2. 调用 LLM 提取三元组
    const prompt = this.buildExtractionPrompt(context);
    const response = await this.callLLM(prompt);

    // 3. 解析并验证结果
    return this.parseAndValidate(response);
  }

  private buildExtractionPrompt(context: string): string {
    return `Analyze the following conversation and extract structured knowledge as entity-relation triples.

Rules:
- Extract entities (people, projects, modules, concepts, decisions, tools, organizations)
- Extract relations between entities (manages, depends_on, created, decided, uses, belongs_to, etc.)
- Each triple must have: subject entity, predicate, object entity
- Assign confidence 0-1 (1 = explicitly stated, 0.5 = inferred)
- Only extract clearly stated or strongly implied facts
- Max ${this.config.maxTriplesPerTurn || 10} triples

Entity types to focus on: ${
      this.config.entityTypes?.length
        ? this.config.entityTypes.join(", ")
        : "person, project, module, concept, decision, tool, organization"
    }

Output as JSON array:
[
  {
    "subject": "entity name",
    "subjectType": "person",
    "predicate": "manages",
    "object": "entity name",
    "objectType": "project",
    "confidence": 0.9,
    "evidence": "quote from conversation"
  }
]

Conversation:
${context}`;
  }
}
```

### 5.3 图搜索（search.ts）

支持三种搜索模式：

```typescript
export class GraphSearch {
  // 1. 实体搜索（FTS + 向量）
  async searchEntities(query: string, limit?: number): Promise<GraphEntity[]>;

  // 2. 关系搜索（从某个实体出发，沿 predicate 遍历）
  async traverse(
    startEntityId: string,
    options: {
      direction?: "outgoing" | "incoming" | "both";
      predicate?: string;
      maxDepth?: number;
      limit?: number;
    }
  ): Promise<{ entity: GraphEntity; relation: GraphRelation; path: string }[]>;

  // 3. 路径查询（A 到 B 的关系路径）
  async findPath(
    fromEntityId: string,
    toEntityId: string,
    maxDepth?: number
  ): Promise<{ entities: GraphEntity[]; relations: GraphRelation[] }[]>;

  // 4. 子图提取（围绕某个实体的 N 层子图）
  async subgraph(
    centerEntityId: string,
    depth?: number
  ): Promise<{
    entities: GraphEntity[];
    relations: GraphRelation[];
  }>;

  // 5. 时序查询（某实体/关系的时间线）
  async timeline(
    entityId: string,
    options?: { from?: string; to?: string }
  ): Promise<TimelineEntry[]>;
}
```

### 5.4 注册的工具

#### `graph_search` — 搜索图谱

```typescript
api.registerTool({
  name: "graph_search",
  description: "Search the knowledge graph for entities and relations. " +
    "Use this to find people, projects, concepts and their relationships.",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    mode: Type.Optional(Type.Union([
      Type.Literal("entity"),     // 搜实体
      Type.Literal("relation"),   // 搜关系
      Type.Literal("path"),       // 搜路径
      Type.Literal("subgraph"),   // 提取子图
      Type.Literal("timeline"),   // 时序查询
    ])),
    entityName: Type.Optional(Type.String({
      description: "Entity name for relation/path/subgraph/timeline modes"
    })),
    targetEntity: Type.Optional(Type.String({
      description: "Target entity for path finding"
    })),
    maxDepth: Type.Optional(Type.Number({
      description: "Max traversal depth (default: 2)"
    })),
  }),
  handler: async (params) => {
    // 根据模式分发到不同搜索方法
  }
});
```

#### `graph_add` — 手动添加实体/关系

```typescript
api.registerTool({
  name: "graph_add",
  description: "Manually add entities or relations to the knowledge graph.",
  parameters: Type.Object({
    entities: Type.Optional(Type.Array(Type.Object({
      name: Type.String(),
      type: Type.String(),
      properties: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }))),
    relations: Type.Optional(Type.Array(Type.Object({
      from: Type.String(),
      predicate: Type.String(),
      to: Type.String(),
      validFrom: Type.Optional(Type.String()),
    }))),
  }),
  handler: async (params) => {
    // 创建或合并实体和关系
  }
});
```

#### `graph_get` — 查询实体详情

#### `graph_query` — 图遍历（邻居、路径）

#### `graph_timeline` — 时序查询

#### `graph_visualize` — 输出 Mermaid/JSON 可视化

```typescript
api.registerTool({
  name: "graph_visualize",
  description: "Generate a visualization of the knowledge graph or a subgraph.",
  parameters: Type.Object({
    format: Type.Union([
      Type.Literal("mermaid"),   // Mermaid diagram
      Type.Literal("json"),      // JSON graph
      Type.Literal("dot"),       // Graphviz DOT
    ]),
    centerEntity: Type.Optional(Type.String()),
    depth: Type.Optional(Type.Number({ default: 2 })),
    filterTypes: Type.Optional(Type.Array(Type.String())),
  }),
  handler: async (params) => {
    // 输出可视化格式
    // Mermaid 示例:
    // graph LR
    //   A[大龙] -->|manages| B[openclaw-plugins]
    //   B -->|contains| C[openclaw-mqtt]
    //   A -->|uses| D[TypeScript]
  }
});
```

### 5.5 afterTurn Hook — 自动提取

```typescript
export function registerAfterTurnHook(
  api: OpenClawPluginApi,
  engine: GraphEngine,
  config: PluginConfig
) {
  let turnCount = 0;

  api.registerHook(
    { event: "after_turn" },
    async (ctx) => {
      turnCount++;

      const frequency = config.extractionFrequency || "every_n_turns";
      const interval = config.extractionInterval || 3;

      if (frequency === "every_n_turns" && turnCount % interval !== 0) return;
      if (frequency === "on_compact" && !ctx.compacted) return;

      // 异步提取，不阻塞主回复
      const messages = ctx.messages || [];
      if (messages.length === 0) return;

      try {
        const result = await engine.extractAndStore(messages);
        // 可选：记录提取了多少三元组到日志
      } catch (err) {
        // 静默失败，不影响主流程
      }
    },
    { blocking: false }  // 非阻塞！
  );
}
```

### 5.6 Memory Corpus Supplement — 让 memory_search 也能搜图谱

```typescript
export function registerCorpusSupplement(
  api: OpenClawPluginApi,
  engine: GraphEngine
) {
  api.registerMemoryCorpusSupplement({
    corpusId: "graph",

    async search(query: string, options?: { limit?: number }) {
      const results = await engine.search.searchEntities(query, options?.limit);
      return results.map(entity => ({
        path: `graph/entity/${entity.id}`,
        content: formatEntityForMemory(entity),
        score: entity.confidence,
      }));
    },

    async get(path: string) {
      // 读取图谱内容
      if (path.startsWith("graph/entity/")) {
        const id = path.replace("graph/entity/", "");
        return engine.storage.getEntity(id);
      }
    },
  });
}
```

---

## 六、用户配置示例

```json5
{
  plugins: {
    entries: {
      "openclaw-memory-graph": {
        enabled: true,
        config: {
          // 自动提取
          autoExtract: true,
          extractionFrequency: "every_n_turns",
          extractionInterval: 3,        // 每 3 轮提取一次
          maxTriplesPerTurn: 10,
          minConfidence: 0.5,

          // 存储
          dbPath: "",                   // 默认 ~/.openclaw/memory/graph/<agentId>.sqlite

          // 时序追踪
          enableTimeline: true,

          // 可选：向量搜索
          enableEmbedding: false,
          embeddingProvider: "openai",

          // 可选：限制关注的实体/关系类型
          entityTypes: [],              // 空 = 全部
          relationTypes: [],            // 空 = 全部
        }
      }
    }
  }
}
```

---

## 七、开发路线图

### Phase 1：MVP（1-2 周）

- [ ] 项目脚手架（package.json、openclaw.plugin.json、tsconfig）
- [ ] SQLite 存储层（entities + relations 表 + FTS5）
- [ ] 核心 GraphEngine（CRUD + 合并去重）
- [ ] `graph_search` 工具（实体搜索 + 关系遍历）
- [ ] `graph_add` 工具（手动添加）
- [ ] `graph_get` 工具（查询详情）
- [ ] 基础三元组提取器（LLM prompt + JSON 解析）
- [ ] afterTurn hook（自动提取）
- [ ] 基础测试（Vitest）

### Phase 2：增强（1 周）

- [ ] `graph_query` 工具（路径查询、子图提取）
- [ ] `graph_timeline` 工具（时序查询）
- [ ] `graph_visualize` 工具（Mermaid 输出）
- [ ] Memory Corpus Supplement（memory_search 集成）
- [ ] 实体合并策略（别名、同义词）
- [ ] 置信度衰减（长时间未见降低置信度）

### Phase 3：高级特性（1-2 周）

- [ ] 向量搜索集成（语义实体匹配）
- [ ] 图谱维护（过期清理、冲突检测）
- [ ] Dashboard 报告（实体统计、关系热力图）
- [ ] CLI 命令（`openclaw graph status/search/export`）
- [ ] Obsidian 可视化集成
- [ ] 与 memory-wiki bridge 模式互操作

---

## 八、与竞品对比

| 特性 | openclaw-memory-graph（我们的） | graph-memory (krissss) | graphiti-memory |
|------|------|------|------|
| 存储 | SQLite | SQLite | Neo4j |
| 外部依赖 | 无 | 无 | Neo4j |
| 集成方式 | Tool + Hook | Context Engine | Plugin |
| 时序追踪 | ✅ | ❌ | ✅✅ |
| 图遍历 | ✅ | ✅ | ✅✅ |
| 可视化 | ✅ Mermaid/JSON | ❌ | ❌ |
| memory_search 集成 | ✅ corpus supplement | ❌ | ❌ |
| 上下文压缩 | ❌ | ✅ 75% | ❌ |
| 中文支持 | ✅ FTS5 trigram | 需验证 | 需验证 |

**我们的差异化：**
1. **时序追踪**——支持关系的时间有效性，能追踪"谁什么时候负责什么"
2. **可视化**——Mermaid/Graphviz 输出，可直接在 Markdown 中渲染
3. **memory_search 融合**——通过 corpus supplement 让一次搜索同时命中文本记忆和图谱
4. **零外部依赖**——SQLite + FTS5，完全本地
5. **不抢占 contextEngine slot**——与其他 context engine 共存

---

## 九、下一步

1. **确认方案**——你看这个方向和技术路线是否合适？
2. **搭建脚手架**——在 `openclaw-plugins/openclaw-memory-graph` 下创建项目
3. **Phase 1 开发**——先跑通最小可用的图谱工具

要我开始搭建项目脚手架吗？
