/**
 * 28 个发布组件的 README 架构摘要。
 *
 * 这里只保存无法从 package.json / openclaw.plugin.json 推导的领域语义；包名、版本、
 * manifest ID、Channel ID 和验证命令由生成器读取真实文件，避免手工副本漂移。
 */

function architecture(categoryZh, categoryEn, inputZh, inputEn, stagesZh, stagesEn, outputZh, outputEn, doesZh, doesEn, excludesZh, excludesEn) {
  return {
    category: { zh: categoryZh, en: categoryEn },
    input: { zh: inputZh, en: inputEn },
    stages: stagesZh.map((zh, index) => ({ zh, en: stagesEn[index] })),
    output: { zh: outputZh, en: outputEn },
    does: { zh: doesZh, en: doesEn },
    excludes: { zh: excludesZh, en: excludesEn },
  };
}

/**
 * 历史上以中文作为默认入口的组件。
 *
 * README.md 继续保持这些组件既有的中文入口，避免统一结构时悄悄改变读者语言；
 * 其中部分组件另有 README.en.md。README.zh-CN.md 始终使用中文，其余 README.md 使用英文。
 */
export const DEFAULT_CHINESE_README_IDS = Object.freeze(new Set([
  "amap",
  "bridge",
  "knowledge",
  "wechat",
  "wechat-ipad",
  "wecom",
  "wecom-kf",
]));

export function readmeLanguage(id, file) {
  if (file === "README.zh-CN.md" || (file === "README.md" && DEFAULT_CHINESE_README_IDS.has(id))) {
    return "zh";
  }
  return "en";
}

export const COMPONENT_ARCHITECTURES = Object.freeze({
  amap: architecture(
    "业务能力 Tool", "Capability tool", "Agent 地点检索请求", "Agent place-search request",
    ["校验白名单操作与参数", "签名并调用高德 Web API", "限制并清洗 Tool Result"],
    ["Validate allowlisted operation and input", "Sign and call AMap Web API", "Bound and sanitize the Tool Result"],
    "结构化地点结果", "Structured place results",
    "提供有界、可审计的地点搜索能力", "Provides bounded and auditable place-search tools",
    "不是地图 Channel，也不代理任意高德 API", "It is not a map channel or an unrestricted AMap proxy",
  ),
  bridge: architecture(
    "Hook / 消息观测桥", "Hook and message observation bridge", "OpenClaw 收发消息 Hook", "OpenClaw inbound/outbound message hooks",
    ["识别来源 Channel 与上下文预设", "规范化为 UnifiedMessage", "注入上下文或投递到 MQ"],
    ["Resolve source channel and context preset", "Normalize into UnifiedMessage", "Inject context or deliver to MQ"],
    "上下文约束与审计消息", "Context constraints and audit messages",
    "跨渠道补充上下文并镜像消息事件", "Adds cross-channel context and mirrors message events",
    "不替代原始 Channel，也不接管平台鉴权", "Does not replace source channels or own platform authentication",
  ),
  douyin: architecture(
    "公域 IM Channel", "Public-platform IM channel", "抖音 Webhook 与运营 Tool", "Douyin webhooks and operation tools",
    ["验签、策略校验与去重", "映射会话并进入 Agent 管线", "通过开放平台 API 回复或执行操作"],
    ["Verify signature, policy, and deduplication", "Map session and enter the Agent pipeline", "Reply or act through Open Platform APIs"],
    "抖音消息与受控运营结果", "Douyin replies and controlled operation results",
    "连接抖音开放平台消息与白名单运营能力", "Connects Douyin messaging and allowlisted operation capabilities",
    "不绕过平台权限、内容审核或人工审批", "Does not bypass platform permissions, moderation, or human approval",
  ),
  gotify: architecture(
    "推送 IM Channel", "Push-notification IM channel", "Gotify REST 消息与 WebSocket Stream", "Gotify REST messages and WebSocket stream",
    ["解析账号、游标与访问策略", "消费入站并运行 Agent", "通过 Application API 发送回复"],
    ["Resolve account, cursor, and access policy", "Consume inbound messages and run the Agent", "Send replies through the Application API"],
    "Gotify 推送与可恢复消费状态", "Gotify notifications and recoverable consumption state",
    "提供双向 Gotify 消息、积压恢复和诊断", "Provides bidirectional Gotify messaging, backlog recovery, and diagnostics",
    "不管理 Gotify Server 用户体系或 Go 插件", "Does not manage Gotify Server users or its Go plugin system",
  ),
  knowledge: architecture(
    "RAG / 知识能力", "RAG and knowledge capability", "文档、知识 Tool 与用户问题", "Documents, knowledge tools, and user queries",
    ["解析、切块并生成向量", "隔离存储并执行混合检索", "重排、限长并注入 Prompt"],
    ["Parse, chunk, and embed", "Store in isolation and run hybrid retrieval", "Rerank, bound, and inject into the prompt"],
    "可追溯知识上下文", "Traceable knowledge context",
    "提供受限写入、检索、重排与自动上下文注入", "Provides controlled ingestion, retrieval, reranking, and context injection",
    "不把远程 Provider 当作可信指令源", "Does not treat remote provider content as trusted instructions",
  ),
  meituan: architecture(
    "业务能力 Tool", "Capability tool", "Agent 美团业务请求", "Agent Meituan business request",
    ["校验操作白名单、确认与参数", "签名并调用 MTOp OpenAPI", "执行重试边界并清洗响应"],
    ["Validate operation allowlist, confirmation, and input", "Sign and call MTOp OpenAPI", "Apply retry boundaries and sanitize responses"],
    "受控业务 API 结果", "Controlled business API results",
    "封装明确批准的美团技术服务接口", "Wraps explicitly approved Meituan technical-service APIs",
    "不提供任意 MTOp 透传或业务授权替代", "Does not provide arbitrary MTOp passthrough or replace business authorization",
  ),
  memory: architecture(
    "长期记忆能力", "Long-term memory capability", "对话 Hook 与显式记忆操作", "Conversation hooks and explicit memory operations",
    ["记录并按作用域隔离会话", "提取 L0→L3 记忆并持久化", "有界召回并注入当前上下文"],
    ["Capture and scope conversations", "Extract and persist L0-to-L3 memories", "Recall with bounds and inject into current context"],
    "长期记忆与用户画像上下文", "Long-term memory and profile context",
    "提供可保留、可召回、可删除的本地记忆", "Provides retainable, recallable, and deletable local memory",
    "不把历史记忆提升为高于当前请求的指令", "Does not elevate historical memory above the current request",
  ),
  "message-sdk": architecture(
    "共享消息 SDK", "Shared message SDK", "各 Channel 的原始消息与媒体", "Raw channel messages and media",
    ["转换为 UnifiedMessage / Envelope", "应用队列、幂等与媒体边界", "桥接 OpenClaw 入站和回复管线"],
    ["Convert into UnifiedMessage and Envelope", "Apply queue, idempotency, and media boundaries", "Bridge OpenClaw inbound and reply pipelines"],
    "跨插件稳定消息契约", "Stable cross-plugin message contract",
    "为 Wire 与 Transcript Channel 提供共享原语", "Provides shared primitives for Wire and Transcript channels",
    "不是可独立启用的运行时 Channel", "It is not a standalone runtime channel",
  ),
  mqtt: architecture(
    "MQTT Wire Channel", "MQTT wire channel", "MQTT Client 发布与订阅", "MQTT client publish and subscribe traffic",
    ["Broker 鉴权、Topic 策略与限流", "解码、去重并进入 Agent", "编码回复并发布到绑定 Topic"],
    ["Broker authentication, topic policy, and limits", "Decode, deduplicate, and enter the Agent", "Encode replies and publish to bound topics"],
    "MQTT 消息与会话结果", "MQTT messages and session results",
    "提供内嵌 Broker、Topic 绑定和可靠入站队列", "Provides an embedded broker, topic bindings, and a reliable inbound queue",
    "不替代外部 MQTT 集群治理或设备 PKI", "Does not replace external MQTT cluster governance or device PKI",
  ),
  mtls: architecture(
    "安全反向代理", "Security reverse proxy", "TLS 客户端连接", "TLS client connections",
    ["校验证书链与客户端身份", "覆盖可信身份头并移除伪造值", "代理 HTTP / WebSocket 到 Gateway"],
    ["Validate certificate chain and client identity", "Overwrite trusted identity headers and remove spoofed values", "Proxy HTTP and WebSocket traffic to Gateway"],
    "经认证的 Gateway 请求", "Authenticated Gateway requests",
    "在 Gateway 前提供双向 TLS 身份边界", "Provides a mutual-TLS identity boundary in front of the Gateway",
    "不签发证书，也不替代 Gateway 内部授权", "Does not issue certificates or replace Gateway authorization",
  ),
  nacos: architecture(
    "配置中心与服务发现", "Configuration and service discovery", "Nacos Config / Naming", "Nacos Config and Naming",
    ["拉取并按层深度合并配置", "展开环境变量、校验并备份写盘", "注册 Gateway 并订阅节点变化"],
    ["Pull and deep-merge configuration layers", "Expand environment values, validate, back up, and write", "Register the Gateway and subscribe to peer changes"],
    "OpenClaw 配置与节点视图", "OpenClaw configuration and peer view",
    "提供配置同步、回滚备份和 Gateway 注册", "Provides configuration sync, rollback backups, and Gateway registration",
    "不替代 Nacos Server 的高可用与权限治理", "Does not replace Nacos Server availability or access governance",
  ),
  oauth2: architecture(
    "OAuth2/OIDC 授权代理", "OAuth2/OIDC authorization proxy", "浏览器或 API 的 Gateway 请求", "Browser or API requests to the Gateway",
    ["发现外部授权服务器并生成授权请求", "校验回调、Token 与会话状态", "注入受信身份并反向代理"],
    ["Discover the external authorization server and create authorization requests", "Validate callback, tokens, and session state", "Inject trusted identity and reverse proxy"],
    "经外部 OAuth2/OIDC 授权的请求", "Requests authorized by external OAuth2/OIDC",
    "作为标准 OAuth2 Client 对接外部身份服务", "Acts as a standard OAuth2 client for an external identity service",
    "不是 OAuth2 Server，也不保存用户密码", "It is not an OAuth2 server and does not store user passwords",
  ),
  openmem: architecture(
    "外部记忆桥", "External memory bridge", "OpenClaw 记忆查询与生命周期事件", "OpenClaw memory queries and lifecycle events",
    ["按租户和会话构造请求", "调用 OpenMem HTTP 召回或写入", "限制、清洗并合并结果"],
    ["Build tenant- and session-scoped requests", "Call OpenMem HTTP recall or ingest", "Bound, sanitize, and merge results"],
    "外部记忆上下文与写入状态", "External memory context and ingest status",
    "把 OpenMem 作为可插拔记忆后端接入", "Connects OpenMem as a pluggable memory backend",
    "不部署 OpenMem 服务，也不绕过其租户隔离", "Does not deploy OpenMem or bypass its tenant isolation",
  ),
  prometheus: architecture(
    "可观测性基础设施", "Observability infrastructure", "OpenClaw Runtime、Hook 与诊断事件", "OpenClaw runtime, hooks, and diagnostic events",
    ["采集有界快照与业务指标", "聚合、限序列并生成 Prometheus 格式", "通过 Gateway 鉴权路由暴露 /metrics"],
    ["Collect bounded runtime and business snapshots", "Aggregate, limit series, and render Prometheus format", "Expose /metrics through an authenticated Gateway route"],
    "Prometheus 指标", "Prometheus metrics",
    "提供 Gateway 内部指标导出和健康诊断", "Exports Gateway metrics and health diagnostics",
    "不运行 Prometheus Server，也不保证业务 SLO", "Does not run Prometheus Server or guarantee business SLOs",
  ),
  rabbitmq: architecture(
    "AMQP Wire Channel", "AMQP wire channel", "RabbitMQ Exchange / Queue", "RabbitMQ exchanges and queues",
    ["建立拓扑、绑定与消费确认", "解码、去重并路由到 Agent", "编码回复并发布到 Exchange"],
    ["Declare topology, bindings, and acknowledgements", "Decode, deduplicate, and route to the Agent", "Encode replies and publish to an exchange"],
    "AMQP 消息与 Agent 回复", "AMQP messages and Agent replies",
    "提供 RabbitMQ Topic 路由与可靠消费", "Provides RabbitMQ topic routing and reliable consumption",
    "不替代 Broker 集群、DLX 和权限运维", "Does not replace broker clustering, DLX, or permission operations",
  ),
  "redis-stream": architecture(
    "Redis Wire Channel", "Redis wire channel", "Redis Pub/Sub 与 Stream", "Redis Pub/Sub and streams",
    ["消费组读取、Claim 与去重", "解码并进入 Agent 管线", "发布回复并确认处理状态"],
    ["Read consumer groups, claim, and deduplicate", "Decode and enter the Agent pipeline", "Publish replies and acknowledge processing state"],
    "Redis 消息与消费游标", "Redis messages and consumption cursors",
    "提供 Pub/Sub 低延迟路径和 Stream 可靠路径", "Provides low-latency Pub/Sub and reliable stream paths",
    "不替代 Redis HA、持久化和容量规划", "Does not replace Redis HA, persistence, or capacity planning",
  ),
  rednode: architecture(
    "业务能力 Tool", "Capability tool", "Agent 小红书 Ark 操作", "Agent RedNote Ark operation",
    ["校验操作白名单、确认和速率", "签名并调用 Ark Open API", "限制响应并脱敏 Tool Result"],
    ["Validate operation allowlist, confirmation, and rate", "Sign and call Ark Open API", "Bound responses and redact Tool Results"],
    "受控 Ark API 结果", "Controlled Ark API results",
    "提供显式登记的小红书商家 API Tool", "Provides explicitly registered RedNote merchant API tools",
    "不是内容抓取器、消息 Channel 或审核替代", "It is not a scraper, messaging channel, or moderation substitute",
  ),
  rocketmq: architecture(
    "RocketMQ Wire Channel", "RocketMQ wire channel", "RocketMQ Topic 消息", "RocketMQ topic messages",
    ["启动 Producer / PushConsumer", "解码、去重并运行 Agent", "发送回复并处理消费结果"],
    ["Start producer and push consumer", "Decode, deduplicate, and run the Agent", "Send replies and handle consumption outcomes"],
    "RocketMQ 消息与消费状态", "RocketMQ messages and consumption state",
    "提供 Topic 绑定、消费重试和回复发布", "Provides topic bindings, consumption retries, and reply publishing",
    "不替代 NameServer/Broker 集群治理", "Does not replace NameServer or broker cluster governance",
  ),
  router: architecture(
    "跨渠道可靠路由", "Reliable cross-channel router", "OpenClaw 消息事件", "OpenClaw message events",
    ["匹配规则、目标与防回环条件", "写入持久 Outbox 并去重", "重试投递，失败进入 DLQ"],
    ["Match rules, targets, and loop guards", "Write to a durable outbox and deduplicate", "Retry delivery and move failures to the DLQ"],
    "目标 Channel 消息与路由状态", "Target-channel messages and routing state",
    "提供可恢复、可观测的跨渠道消息转发", "Provides recoverable and observable cross-channel forwarding",
    "不改变目标 Channel 的鉴权和发送策略", "Does not alter target-channel authentication or send policy",
  ),
  stomp: architecture(
    "STOMP/TCP Wire Channel", "STOMP/TCP wire channel", "原生 STOMP Client / Broker", "Native STOMP clients and brokers",
    ["协商连接、订阅与 ACK 模式", "解析 Frame、绑定会话并运行 Agent", "发送 Frame 并处理 ACK/NACK"],
    ["Negotiate connection, subscriptions, and ACK mode", "Parse frames, bind sessions, and run the Agent", "Send frames and handle ACK/NACK"],
    "STOMP Frame 与交付状态", "STOMP frames and delivery state",
    "提供原生 TCP STOMP、Topic 绑定和累计确认", "Provides native TCP STOMP, topic bindings, and cumulative acknowledgement",
    "不提供完整通用 Broker 或 JMS 实现", "Does not provide a full general-purpose broker or JMS implementation",
  ),
  tracing: architecture(
    "分布式追踪基础设施", "Distributed tracing infrastructure", "消息、Tool、Agent 与会话 Hook", "Message, tool, Agent, and session hooks",
    ["建立 Trace/Span 关联和容量边界", "记录阶段、错误与耗时", "导出到 OTLP、文件或日志后端"],
    ["Create trace/span correlation with capacity bounds", "Record stages, errors, and latency", "Export to OTLP, file, or log backends"],
    "可关联的链路追踪数据", "Correlated tracing data",
    "提供 Agent 全链路关联和可插拔导出", "Provides end-to-end Agent correlation and pluggable export",
    "不替代 Collector、采样治理或告警系统", "Does not replace collectors, sampling governance, or alerting",
  ),
  "web-mqtt": architecture(
    "MQTT/WebSocket Wire Channel", "MQTT/WebSocket wire channel", "浏览器 MQTT over WebSocket", "Browser MQTT over WebSocket traffic",
    ["建立 WebSocket 与 MQTT 会话", "应用 Topic 策略、解码和去重", "运行 Agent 并发布绑定回复"],
    ["Establish WebSocket and MQTT sessions", "Apply topic policy, decoding, and deduplication", "Run the Agent and publish bound replies"],
    "Web MQTT 消息", "Web MQTT messages",
    "为 Web 客户端提供 MQTT Channel 接入", "Provides MQTT channel access for web clients",
    "不替代生产 MQTT Broker 的集群能力", "Does not replace production MQTT broker clustering",
  ),
  "web-socket": architecture(
    "原生 WebSocket Channel", "Native WebSocket channel", "WebSocket JSON/Text 客户端", "WebSocket JSON/text clients",
    ["鉴权、连接限额与协议解析", "映射会话并进入 Agent", "按连接路由发送响应"],
    ["Authenticate, limit connections, and parse protocol", "Map sessions and enter the Agent", "Route responses back to connections"],
    "WebSocket 消息与连接状态", "WebSocket messages and connection state",
    "提供轻量嵌入式 WebSocket 消息入口", "Provides a lightweight embedded WebSocket message endpoint",
    "不提供跨节点连接共享或通用 Socket.IO 协议", "Does not provide cross-node connection sharing or Socket.IO compatibility",
  ),
  "web-stomp": architecture(
    "STOMP/WebSocket Wire Channel", "STOMP/WebSocket wire channel", "Spring/Web STOMP Client", "Spring and web STOMP clients",
    ["升级 WebSocket 并协商 STOMP", "处理订阅、Frame、心跳和 ACK", "运行 Agent 并发送 STOMP MESSAGE"],
    ["Upgrade WebSocket and negotiate STOMP", "Handle subscriptions, frames, heartbeats, and ACK", "Run the Agent and send STOMP MESSAGE frames"],
    "Web STOMP 消息与订阅状态", "Web STOMP messages and subscription state",
    "面向浏览器和 Spring 生态提供 STOMP 接入", "Provides STOMP access for browsers and the Spring ecosystem",
    "不实现 SockJS、完整 Broker Relay 或 JMS", "Does not implement SockJS, a full broker relay, or JMS",
  ),
  wechat: architecture(
    "微信 IM Channel", "Weixin IM channel", "微信 iLink 长轮询消息", "Weixin iLink long-poll messages",
    ["账号解析、配对/白名单与游标恢复", "下载受控媒体并运行 Agent", "通过 iLink API 发送回复并提交游标"],
    ["Resolve account, pairing/allowlist, and cursor recovery", "Fetch bounded media and run the Agent", "Send replies through iLink and commit the cursor"],
    "微信消息与本地账号状态", "Weixin messages and local account state",
    "提供扫码登录、长轮询、媒体和多账号会话", "Provides QR login, long polling, media, and multi-account sessions",
    "不应把插件 ID `wechat` 与 Channel ID `openclaw-weixin` 混用", "Plugin ID `wechat` and channel ID `openclaw-weixin` must not be mixed",
  ),
  "wechat-ipad": architecture(
    "非官方桥接 IM Channel", "Unofficial bridge IM channel", "独立 iPad 协议服务的 WebSocket/HTTP", "WebSocket/HTTP from a separate iPad protocol service",
    ["校验桥接来源、白名单与去重状态", "排队处理消息并运行 Agent", "调用桥接 HTTP API 回复并持久化结果"],
    ["Validate bridge origin, allowlist, and deduplication state", "Queue messages and run the Agent", "Reply through the bridge HTTP API and persist outcomes"],
    "微信消息与桥接健康状态", "WeChat messages and bridge health state",
    "仅桥接独立运行的协议服务，不在插件内实现协议", "Only bridges a separately operated protocol service; the protocol is not implemented here",
    "非官方协议有封号与合规风险，不能等同官方生产通道", "The unofficial protocol carries account and compliance risk and is not equivalent to an official production channel",
  ),
  wecom: architecture(
    "企业微信 IM Channel", "WeCom IM channel", "企业微信 Bot、Agent 与 Webhook 事件", "WeCom bot, agent, and webhook events",
    ["验签解密、账号/租户策略与去重", "组装 Transcript 并运行 Agent", "通过企业微信 API 发送文本、媒体或流式结果"],
    ["Verify/decrypt, enforce account/tenant policy, and deduplicate", "Assemble the transcript and run the Agent", "Send text, media, or streaming results through WeCom APIs"],
    "企业微信消息、MCP/Skill 与运营状态", "WeCom messages, MCP/skills, and operation state",
    "提供多形态企业微信接入、媒体和业务 Skills", "Provides multiple WeCom entry modes, media, and business skills",
    "不替代企业微信管理员授权、数据治理或知识插件", "Does not replace WeCom admin authorization, data governance, or the knowledge plugin",
  ),
  "wecom-kf": architecture(
    "企业微信客服 Channel", "WeCom customer-service channel", "微信客服回调与 Sync 消息", "WeCom KF callbacks and sync messages",
    ["验签解密、游标持久化与客户/账号映射", "路由到指定 Agent 并生成回复", "发送客服消息或通过 Control Tool 转人工"],
    ["Verify/decrypt, persist cursors, and map customer/account", "Route to the selected Agent and generate a reply", "Send KF messages or hand off through control tools"],
    "客服会话、转人工状态与审计事件", "Customer-service sessions, handoff state, and audit events",
    "提供多 Agent 客服路由和隔离的控制类 Tools", "Provides multi-Agent KF routing and isolated control tools",
    "控制面结果不进入 LLM transcript，且不替代人工客服流程", "Control-plane results do not enter the LLM transcript and do not replace human-service operations",
  ),
});
