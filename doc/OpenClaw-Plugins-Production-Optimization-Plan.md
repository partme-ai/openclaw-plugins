# OpenClaw Plugins 生产优化计划

更新时间：2026-07-16  
目标 OpenClaw：2026.7.1

## 基线说明

- `nacos`、`wecom`：用户已在上一版本的真实环境验证。后续只做 2026.7.1 回归、兼容性和发布门禁，不优先重构。
- 除 `nacos`、`wecom` 外的插件：按安全风险、共享影响面、数据可靠性、外部渠道依赖的顺序逐个优化。
- 原独立 `cluster` 插件已按产品决策删除；Nacos 内置的节点发现与 `/nacos/cluster` 能力不受影响。
- 单个插件完成标准：真实入口契约、类型检查、构建、单元/契约测试、必要的进程内 E2E、结构检查、部署文档均通过。

## 优化顺序

| 顺序 | 插件 | 主要目标 | 状态 |
|---:|---|---|---|
| 1 | mtls | 改为真实 HTTPS/mTLS 代理并接入 trusted-proxy | 已完成代码与本地 E2E，待环境验收 |
| 2 | oauth2 | 修复错误的 HTTP Route 中间件模型，接入 Gateway 正式鉴权路径 | 已完成代码与本地 E2E，待环境验收 |
| 3 | mqtt | 统一 ACL fail-closed 契约，恢复全量测试 | 已完成代码与本地 Redis E2E，待环境验收 |
| 4 | web-mqtt | 复用统一 ACL，补 WSS 与浏览器鉴权 | 已完成代码与本地 WSS E2E，待环境验收 |
| 5 | douyin | 清除 TODO 占位，实现真实开放平台 API | 已完成代码与协议测试，待环境验收 |
| 6 | memory | 实现保留策略、异步存储与真实能力分层 | 已完成代码与可靠性测试，待环境验收 |
| 7 | openmem | HTTP 超时、重试、鉴权、完整 Memory Host 契约 | 已完成代码与真实 sidecar E2E，待受保护环境验收 |
| 8 | web-socket | 鉴权、背压、心跳、结构补全与 E2E | 已完成代码与真实连接测试，待环境验收 |
| 9 | web-stomp | WSS、认证、会话隔离、背压、资源限制与生命周期 | 已完成代码与真实 WSS 测试，待环境验收 |
| 10 | stomp | TCP/TLS、认证、ACK、会话隔离、有界队列与生命周期 | 已完成代码与真实 TLS 测试，待环境验收 |
| 11 | rabbitmq | Confirm、重试/DLQ、可靠 ACK 与真实 Broker 验证 | 已完成代码与本地 RabbitMQ E2E，待环境验收 |
| 12 | redis-stream | PEL 回收、有界重试/DLQ、可靠停机与真实 Redis 验证 | 已完成代码与本地 Redis E2E，待环境验收 |
| 13 | rocketmq | 可靠 ACK/NACK、SDK 退避兼容、DLQ、生命周期与真实 Broker 验证 | 已完成代码与本地 RocketMQ E2E，待环境验收 |
| 14 | gotify | WS 生命周期、backlog 有界恢复、消息确认语义与诊断路由 | 已完成代码、本地真实 Gotify 2.9.1 E2E，待正式环境验收 |
| 15 | router | 官方 Hook/Outbound 契约、持久 Outbox、重试/DLQ、跨进程单写与真实投递 | 已完成代码、本地 Router→Gotify E2E，待正式环境验收 |
| 16 | bridge | 官方消息 Hook、公共 Outbound Adapter、配置/渠道清单纠偏与有界重试 | 已完成代码、安装态与契约验证，待真实 MQ 环境验收 |
| 17 | tracing | 官方 Hook 生命周期、OTLP/File 可靠导出、有界资源、健康诊断与隐私边界 | 已完成代码与本地契约验证，待真实 Collector 环境验收 |
| 18+ | 其余插件 | 按业务渠道、观测、RAG、共享组件依次推进 | 待处理 |

## mTLS 当前交付

- 独立 HTTPS/mTLS 反向代理，不再伪装为 `registerHttpRoute` 全局中间件。
- TLS 1.2+、CA 客户端证书校验、CN/issuer/fingerprint 白名单。
- HTTP 和 WebSocket Upgrade 转发。
- 覆盖客户端伪造的 trusted-proxy 身份 Header。
- 未配置默认禁用；启用但证书缺失时 fail closed。
- 真实 OpenSSL CA/服务端/客户端证书集成测试。

本地门禁（2026-07-15）：

- `pnpm --dir extensions/mtls test`：2 个测试文件、12 个测试通过。
- `pnpm --dir extensions/mtls typecheck`：通过。
- `pnpm --dir extensions/mtls build`：通过。
- 根工作区 `pnpm typecheck`、`pnpm build`：通过，构建覆盖 31 个工作区包。
- `git diff --check`：通过。

环境验收时还需使用真实域名证书启动 Gateway，执行 `openclaw security audit`，并确认 Gateway 上游端口未直接暴露。

## OAuth2 当前交付

- 独立 Bearer Resource Server HTTP/WebSocket 反向代理，接入 OpenClaw `trusted-proxy`。
- 仅使用 `openid-client` 实现标准 OAuth2/OIDC Authorization Code Client：Discovery、PKCE、token、userinfo、introspection、refresh、revoke 全链路。
- 支持显式配置授权、Token、UserInfo、Introspection、Revocation 端点，以及 `client_secret_post`、`client_secret_basic`、公共客户端。
- 非 loopback issuer 与端点强制 HTTPS；Bearer Token 只允许通过 Authorization Header 传入。
- 覆盖伪造的 forwarded/user/tenant/scope headers，禁止扩展参数覆盖 state、PKCE、授权码等安全字段。
- HttpOnly/SameSite 会话、一次性 state 与站内 returnTo 校验。
- Redis 共享 state/session/token，已验证跨两个插件实例读取与删除。

环境验收需要接入至少一个真实标准 OAuth2/OIDC Server，验证 Discovery 或显式端点配置、自定义身份字段、授权 Scope、PKCE、刷新与吊销传播，以及 Server 故障策略。

## Douyin 当前交付

- Webhook 使用常量时间比较校验 `SHA1(app_secret + rawBody)`，同时校验事件 `client_key`。
- `verify_webhook` 按官方协议返回 JSON challenge；普通事件兼容 object 和 JSON 字符串两种 `content`。
- 强制普通事件携带 `Msg-Id`，幂等窗口扩展为 24 小时/10000 条；先响应成功再异步派发，满足官方 2.5 秒确认窗口。
- `client_token` 使用按凭据隔离的本地缓存、并发请求合并和提前刷新，平台 Token 失效时仅刷新对应账号。
- `douyin_query_orders` 已对接官方 `GET /goodlife/v1/trade/order/query/`，校验分页上限并支持 cursor/订单/状态/时间筛选。
- `douyin_reply_review` 已对接官方 `POST /goodlife/v1/akte/comment/reply/`，使用 `account_id`、`poi_id`、`rate_id`、`text` 正式参数。
- OpenAPI 使用官方 `access-token` Header，平台错误不再伪装为空数据成功；只对安全查询执行有限重试。
- 生活服务 Webhook 没有对称私信 API，通用 `sendText` 和 Agent 回复不再返回虚假送达结果。
- 清单版本与包版本对齐，配置 Schema 补齐多账号、商户、POI、超时和安全字段。

本地门禁（2026-07-15）：

- `pnpm --dir extensions/douyin test`：10 个测试文件、69 个测试通过。
- `pnpm --dir extensions/douyin typecheck`：通过。
- `pnpm --dir extensions/douyin build`：通过。

环境验收还需使用已获 `life.capacity.order.query`、`life.capacity.catering.comment` 和评价回复权限的真实生活服务应用，验证 HTTPS Webhook、重复投递、订单查询、Token 轮换及评价回复。

## Memory 当前交付

- 按 Agent 哈希目录物理隔离数据；全部层级默认再按 session 过滤。只有显式设置 `profileScope: "agent"` 的单用户 Agent 才允许 L3 跨 session 召回。
- `agent_end` 只保存当前轮消息，使用 `runId` 做持久化幂等，避免每轮重复写入完整历史。
- L0/L1/L2/L3 均有真实数据模型：当前轮、情景记忆、周期场景、明确偏好/身份/长期指令画像。
- 全部文件 I/O 改为异步，同一 JSONL 文件写入串行化；服务停止前排空队列。
- `retentionDays` 在启动时和每日生效；过期的对话、情景、场景和画像文件会自动删除。
- Agent 工具使用 OpenClaw 可信 `agentId`/`sessionKey` 上下文，拒绝目录穿越且禁止读取 L0 原始对话。
- 可通过 `encryptionKeyEnv` 启用 AES-256-GCM 逐行静态加密；密钥缺失时启动失败。
- 明确标注为本地词法检索，不宣称向量或语义能力；多节点共享记忆交由 OpenMem 等外部后端。

本地门禁（2026-07-15）：

- `pnpm --filter @partme.ai/openclaw-memory test`：1 个测试文件、21 个测试通过。
- `pnpm --filter @partme.ai/openclaw-memory typecheck`：通过。

环境验收还需在真实 OpenClaw Gateway 上验证自动注入、进程重启幂等、90 天清理、密钥轮换策略及大文件/高并发磁盘压力。当前静态加密不支持在线密钥轮换，轮换前应导出或迁移旧数据。

## OpenMem 当前交付

- 按 OpenMem 真实 REST Schema 修复搜索结果映射：使用 `chunk.text`、`source`、`recall_type`，不再读取不存在的 `content`。
- 接入 OpenClaw `session_start` / `agent_end` / `session_end`：创建或恢复 ACTIVE session、当前轮事件 ingest、working memory append、结束时 commit/archive。
- `runId + 消息序号` 生成稳定 SHA-256 `eventId`，使 `/events/ingest` 可有限重试且不会重复写事件。
- HTTP 客户端具备超时、幂等请求有限指数退避、响应大小上限、JSON/Schema 校验、调用方取消及关闭时中止。
- 可配置 `required` 启动策略；可通过 `apiKeyEnv`、`authHeader`、`authScheme` 向鉴权反向代理发送密钥，配置中不存明文 secret。
- 默认只服务一个 `agentId`；`allowSharedRecall: false` 时仅召回同一 OpenClaw sessionKey 的上一条归档，避免 OpenMem 全局 keyword/hybrid 搜索跨租户泄漏。
- `readFile` 使用搜索结果缓存，并支持 archive/externalized-memory 正式详情端点和分页。
- 能力探测如实声明当前 OpenMem 是 FTS5 + 字符 n-gram 重排，不是 embedding/vector 搜索。

本地门禁（2026-07-15）：

- `pnpm --filter @partme.ai/openclaw-openmem test`：3 个测试文件、26 个测试通过。
- `pnpm --filter @partme.ai/openclaw-openmem typecheck`：通过。
- `pnpm --filter @partme.ai/openclaw-openmem build`：通过。
- 启动本地 OpenMem Server 后，构建产物真实执行 `start → ingest → append → commit/archive → continuity recall`，成功召回归档内容。

环境验收仍有外部前置条件：当前 OpenMem Server 没有内置请求鉴权，且 `app.listen(PORT)` 未显式绑定 loopback。生产环境必须使用容器/防火墙网络隔离或鉴权反向代理；在该条件满足前，不能把 sidecar 网络暴露标为生产就绪。

## MQTT 当前交付

- 默认仅监听 `127.0.0.1`；未启用认证时禁止绑定非 loopback 地址。
- 认证开启但未配置用户时启动失败；匿名用户和未知身份的 ACL 均为 fail closed。
- 匿名访问必须显式配置 `anonymous` 用户及其发布/订阅 ACL。
- `maxConnections` 现在是实际连接上限，而不是误作 Aedes 并发参数。
- TCP、TLS、Aedes、Redis 的启动失败回滚与异步关闭均等待资源真正释放。
- Redis 持久化使用正确的 `conn` / `packetTTL` 契约；MQEmitter 使用独立 Pub/Sub 连接和集群前缀，避免共享 Redis 时跨环境串消息。
- 插件清单补齐 `host`、`tls.port`、`packetTTL` 并拒绝未知根配置。
- 文档按 Aedes 真实能力修正为 MQTT 3.1/3.1.1；MQTT 5.0 当前不支持。

本地门禁（2026-07-15）：

- `TEST_REDIS_URL=redis://127.0.0.1:16379 pnpm --dir extensions/mqtt test`：10 个测试文件、57 个测试通过，包含真实 Redis 8.4。
- `pnpm --dir extensions/mqtt typecheck`：通过。
- `pnpm --dir extensions/mqtt build`：通过。

环境验收还需在两台 Gateway 进程上验证 Redis 跨节点 QoS/订阅传播、TLS 设备证书、断网重连、Redis 故障恢复、连接上限和高负载背压。

## Web-MQTT 当前交付

- 明文 WS 默认仅监听 `127.0.0.1`；非 loopback 必须启用 WSS。
- 认证用户使用实际认证映射参与 ACL；未知用户、无规则用户和匿名用户均 fail closed。
- 匿名访问必须显式配置 `anonymous` 用户及 ACL。
- `maxConnections` 和 `maxSubscriptionsPerClient` 现在是实际运行时上限。
- 浏览器 `Origin` 使用精确白名单，未列出的 Origin 在 WebSocket 握手阶段返回 403；原生客户端可不发送 Origin。
- 默认关闭 WebSocket 压缩，降低不可信载荷的压缩资源消耗；帧上限与 MQTT payload 上限保持一致。
- WSS 缺少 key/cert、未实现的 PROXY Protocol、错误的网络暴露配置均启动 fail-fast。
- 启动失败回滚、WebSocket client terminate、HTTP(S)/Aedes 关闭均等待完成。
- 清单版本与包版本对齐，修复 npm 打包中错误的 README/RELEASING 文件名。

本地门禁（2026-07-15）：

- `pnpm --dir extensions/web-mqtt test`：13 个测试文件、54 个测试通过，包含真实 OpenSSL WSS 握手。
- `pnpm --dir extensions/web-mqtt typecheck`：通过。
- `pnpm --dir extensions/web-mqtt build`：通过。

环境验收还需使用真实浏览器域名、正式证书和反向代理验证 Origin 转发、WSS 断线重连、连接洪峰、慢客户端和大规模订阅压力。

## WebSocket 当前交付

- 默认监听从 `0.0.0.0` 收紧为 `127.0.0.1`；远程明文监听必须配置 token 并显式确认 `allowInsecureRemote`。
- 服务端改为在 HTTP upgrade 阶段完成路径、Origin、Bearer token 和连接上限校验，未授权连接不再先完成 WebSocket 握手。
- token 使用 SHA-256 固定长度摘要与 `timingSafeEqual` 比较；查询参数 token 默认关闭，客户端不再把 token 写入 URL。
- 默认忽略入站帧自报的 `agentId`，只接受服务端 `defaultAgentId` / `agentBindings`；需要客户端选择 Agent 时必须显式启用 `allowFrameAgentId`。
- 每连接增加分钟级消息限速、串行异步入站队列和最大待处理数，避免慢 Agent 导致无限积压。
- 出站检查 `bufferedAmount` 与 UTF-8 帧大小，慢客户端超过上限时快速断开。
- 服务端和客户端均增加 WebSocket ping/pong 心跳、pong 超时；客户端增加握手超时和受控指数退避。
- 连接清理实现幂等，停机主动 terminate 存量 socket 并等待 HTTP/WebSocket Server 关闭；移除插件级全局 `SIGTERM` 监听。
- 状态接口继续由 OpenClaw 插件认证保护，并对 token 和客户端 headers 脱敏。
- 补齐 LICENSE、中文 README、发布文件和真实 WebSocket transport 集成测试。

本地门禁（2026-07-15）：

- `pnpm --filter @partme.ai/openclaw-web-socket test`：4 个测试文件、20 个测试通过，包含真实 HTTP upgrade 鉴权、Origin 拒绝、query token 拒绝、客户端 Bearer header、异步消息顺序与带活跃连接停机。
- `pnpm --filter @partme.ai/openclaw-web-socket typecheck`：通过。
- `pnpm --filter @partme.ai/openclaw-web-socket build`：通过。

环境验收还需使用正式 TLS 反向代理和真实浏览器验证 `wss://`、Origin 转发、token 轮换、断线重连、连接洪峰、慢客户端及长时间心跳稳定性。

## Web-STOMP 当前交付

- 按 STOMP 1.2 实现 CONNECT 前置状态机和 login/passcode 认证；支持环境变量明文凭证及 SHA-256/SHA-512 哈希，比较使用固定长度摘要与 `timingSafeEqual`。
- 默认仅监听 `127.0.0.1`；非 loopback 地址强制启用 WSS，TLS 证书缺失或认证用户为空时启动失败。
- WSS 使用真实 HTTPS Server；Upgrade 阶段校验精确路径、Origin 白名单和连接上限，并关闭 WebSocket 压缩。
- 实现 STOMP 心跳协商、CONNECT 超时、入站消息限速、串行异步队列、帧大小上限、出站 `bufferedAmount` 背压、订阅与待 ACK 上限。
- `SEND` 仅允许访问 `defaultAgentId` 和 `allowedAgentIds`；RECEIPT 在 OpenClaw 入站派发成功后才返回。
- 默认只允许订阅当前连接自己的 `/topic/session.stomp:<connectionId>@<agentId>` 回复主题，阻止跨会话窃听；共享主题必须显式开启。
- ACK/NACK 按连接隔离，修复 ACK header 与 pending key 不一致的问题；重复订阅 ID 被拒绝。
- 接入 OpenClaw 2026.7.1 正式 Channel Gateway 生命周期，移除插件级全局进程信号监听，启动失败可回滚，带活跃连接停机可完成。
- 清单、版本、打包文件和中英文文档已对齐；删除仓库中误提交的旧 `.tgz`。
- 文档明确能力边界：订阅和 ACK 状态仅在内存中，NACK 不重投，也不提供持久队列、死信或 Broker 集群语义。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/web-stomp test`：12 个测试文件、60 个测试通过，包含真实 OpenSSL WSS、认证、Origin、连接上限、会话隔离、心跳、启动回滚和活跃连接停机。
- `pnpm --dir extensions/web-stomp typecheck`：通过。
- `pnpm --dir extensions/web-stomp build`：通过。
- `npm pack --dry-run --json`：18 个预期文件，包含 LICENSE、英文/中文 README、清单和构建产物，不含旧归档。

环境验收还需使用正式证书、真实浏览器和 `@stomp/stompjs` 验证 WSS/Origin、凭证轮换、Agent 完整回复、长时间心跳、慢客户端、连接洪峰和大规模订阅。需要持久化、重投、死信或事务语义的业务必须使用 RabbitMQ 等消息代理，不能把本插件当作生产 Broker。

## STOMP TCP 当前交付

- 插件明确为 STOMP 1.2 子集，不再错误宣称完整支持 1.0/1.1/1.2；支持 CONNECT、SEND、SUBSCRIBE、UNSUBSCRIBE、ACK、NACK 和 DISCONNECT。
- 明文 TCP 默认仅监听 `127.0.0.1`，非 loopback 明文配置启动失败；远程接入使用 TLS 1.2+，支持可选 mTLS。
- 认证从“任意非空 login/passcode 即通过”改为 fail-closed 用户表，支持环境变量凭证和 SHA-256/SHA-512 哈希；未配置用户时拒绝启动。
- 非 loopback TLS 监听必须启用 login 认证或验证客户端证书，避免仅加密但无身份校验的公网服务。
- CONNECT 前命令被拒绝，认证失败关闭连接；STOMP 心跳真实协商并发送，超时连接主动清理。
- SEND 只允许标准 Agent 队列、Agent 白名单或显式 `topicBindings`；客户端不能通过自报 peer/Agent 绕过服务端路由。
- 默认订阅范围限定到当前 `session` 的回复 Topic，移除与 Web-STOMP 冲突的 `stomp` 渠道别名；共享 Topic 必须显式开启。
- `SEND` RECEIPT 在 OpenClaw 异步派发完成后返回；`client` 使用累计 ACK，`client-individual` 使用单条 ACK，NACK 默认有界重入队。
- 连接、帧、Socket 缓冲、消息速率、入站队列、订阅、prefetch、单订阅队列和进程内 durable state 均有硬上限。
- 启动失败完整回滚 TCP/TLS Listener，Gateway 停机销毁活动连接并等待 Server 关闭；移除插件级 `SIGTERM` 和旧 `registerService` 旁路。
- 状态接口要求插件认证并对凭证脱敏；清单、包版本、发布文件和中英文文档对齐，删除旧 `.tgz` 及无效子包 pnpm 配置。
- 文档明确能力边界：durable state 只在进程内，重启即丢失；不支持事务、磁盘持久化、死信、Broker 集群或 exactly-once。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/stomp test`：10 个测试文件、41 个测试通过，包含真实 TCP、OpenSSL TLS、认证、会话隔离、异步 RECEIPT、心跳、连接上限、ACK/NACK、启动回滚和活动连接停机。
- `pnpm --dir extensions/stomp typecheck`：通过。
- `pnpm --dir extensions/stomp build`：通过。
- `npm pack --dry-run --json`：14 个预期文件，包含 LICENSE、双语 README、清单和构建产物，不含旧归档。

环境验收还需使用正式 CA/证书和真实 Java/企业 STOMP Client 验证凭证轮换、mTLS、Agent 完整回复、长时间心跳、半开连接、慢消费者、重连风暴和高并发订阅。需要跨进程持久化、事务、死信或集群语义时应改用 RabbitMQ，不应扩张内嵌插件职责。

## RabbitMQ 当前交付

- 默认使用稳定、持久的 `openclaw.rabbitmq` 队列，多个 Gateway 实例按 competing consumers 分摊消息；广播语义要求显式配置不同队列名。
- 出站回复、重试转发与死信转发均使用 Confirm Channel、持久消息、confirm 超时和 drain 背压；只有 Broker 确认下一跳后才 ACK 原投递。
- 重试流量进入独立 `<exchange>.retry`，避免重试消息被主 Exchange 的宽泛 binding 提前消费；TTL 到期后按原 routing key 回流。
- 重试耗尽进入独立 `<exchange>.dlx` / `<queue>.dlq`，不再无限热 requeue；重试发布失败时原消息重新入队。
- 幂等默认开启，并从“接收即记录”改为 claim/commit/release，处理或回复失败会释放 claim；无稳定 messageId/correlationId 时不误判相同正文。
- 停止与连接恢复会重新入队所有未 settle 投递；意外断开使用单一后台重连循环持续恢复，健康状态暴露 reconnecting、confirm、retry 和 DLQ 计数。
- 配置校验 fail-fast，拒绝非法 AMQP 协议和不安全的 quorum queue 组合；状态接口使用精确路由、`no-store` 并脱敏 URL 凭据。
- 包版本和清单对齐到 2026.7.1，修复中文 README 打包文件名并删除仓库中的旧 `.tgz`。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/rabbitmq test`：10 个测试文件、109 个通过、1 个条件跳过；包含显式配置探测、confirm、retry、DLQ、deferred ACK 和 claimable idempotency。
- 临时 `rabbitmq:3.13-alpine` 容器：真实 publish → broker confirm → consume → ACK 闭环通过，容器已清理。
- `pnpm --dir extensions/rabbitmq typecheck`：通过。

环境验收还需在正式 RabbitMQ 集群验证 TLS/凭据轮换、quorum queue、节点故障、网络分区、镜像升级、积压恢复、重连风暴和跨实例业务幂等。当前进程内幂等不能宣称跨节点 exactly-once。

## Redis Stream 当前交付

- Stream 使用独立阻塞消费连接，避免 `XREADGROUP` 阻塞出站发布；启动任一步失败都会回滚已建立的客户端。
- 消息仅在 Agent 派发和 Stream 回复写入成功后 `XACK`；失败会释放幂等 claim 并留在 PEL，避免重投被错误当成已完成重复消息。
- `XAUTOCLAIM` 回收超时 PEL；达到 `maxAttempts` 后以 Redis 事务原子执行 DLQ `XADD` 与原 Stream `XACK`，避免无限热重试。
- 出站与 DLQ 支持近似 `MAXLEN`，消费者名留空时按 hostname + pid 唯一生成，多 Gateway 副本可安全竞争消费。
- Stream 回复使用持久化 `XADD`，不再错误降级为 Pub/Sub `PUBLISH`；Pub/Sub 模式明确保持 at-most-once。
- 重连统计、连接状态、失败与 DLQ 计数进入认证状态端点；健康/状态路由精确匹配并设置 `no-store`。
- 配置拒绝非 `redis://` / `rediss://` URL 和未知字段，URL 用户名、密码均脱敏；包与清单版本对齐 OpenClaw 2026.7.1。
- E2E 注册表与 Docker Compose 已接入 Redis 7，真实覆盖消费组读取、Agent 回复、ACK、PEL 回收和 DLQ。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/redis-stream test`：单元/契约测试通过；无 Redis 时真实集成测试条件跳过。
- 临时 `redis:7-alpine` 容器：真实 `XREADGROUP → Agent → XADD reply → XACK` 与失败 `XAUTOCLAIM → DLQ → XACK` 两条闭环通过，容器已清理。
- `pnpm --dir extensions/redis-stream typecheck`、`build`、`npm pack --dry-run --json`：通过。

环境验收还需在正式 Redis HA 环境验证 TLS/ACL、主从切换、网络分区、积压恢复、重连风暴和跨实例业务幂等。原生 Redis Cluster 拓扑发现当前不支持；若通过代理接入 Cluster，入站与 DLQ key 必须使用相同 hash tag。进程内幂等不能宣称跨节点 exactly-once。

## RocketMQ 当前交付

- 只有 Agent 派发与可选回复发布成功后才返回 ACK；临时失败返回 `ConsumeResult.FAILURE`，幂等 claim 会释放，Broker 再投可重新处理。
- 幂等默认开启并改为 claim/commit/release；进程内并发重复和已完成重复被 ACK，不把失败消息提前标记为完成。
- `rocketmq-client-nodejs` 升级到 1.0.7；针对其不实现 Broker customized-backoff、首投 attempt 可能为 0 的缺口，使用可配置安全指数退避。
- 非 FIFO 消息达到 `consumer.retry.maxAttempts` 后显式调用 Broker DLQ API；只有 DLQ 转发成功才 ACK 原消息，失败则继续 NACK，避免毒消息静默丢失。
- 启动配置 fail-fast，支持可中断启动退避、部分启动回滚、重复启动保护和停止后状态清理；Producer 发送尝试次数可配置。
- 健康与状态使用精确路由和 `no-store`，永久不可路由消息单独计为 dropped，不污染连接健康；ACL 三项凭据全部脱敏。
- 插件 ID、清单与包版本统一为 `rocketmq` / 2026.7.1，移除不存在的 `mq.publish` 契约、旧 `.tgz` 和过时文档。
- E2E Compose 增加 Broker/NameServer 就绪控制、Topic/Consumer Group 初始化和异常墙钟防护。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/rocketmq test`：7 个测试文件，72 个通过、2 个条件跳过；覆盖配置、路由、wire 幂等键、claimable idempotency、启动回滚、中断、NACK 与显式 DLQ。
- `apache/rocketmq:5.3.2` Namesrv + Broker + Proxy：真实 NACK、再次投递 ACK、耗尽后 Broker DLQ 转发及 DLQ 消费两条测试通过。
- `pnpm --dir extensions/rocketmq typecheck`、`build`、`npm pack --dry-run`：通过，双语 README 与 2026.7.1 清单均进入包。

环境验收还需在正式 RocketMQ 集群验证 ACL/TLS、Consumer Group 策略对齐、Broker/Proxy 故障、网络分区、再均衡、积压恢复和跨实例业务幂等。进程内幂等不能宣称跨节点 exactly-once；`consumer.retry.maxAttempts` 应与服务端 Consumer Group 策略保持一致。

## Gotify 当前交付

- WebSocket listener 增加并发重复启动合并、连接代际隔离和初始连接失败收口，不再留下后台幽灵重连循环。
- backlog replay 增加分页前移校验、消息 ID 去重和默认 10000 条内存安全上限，异常时 fail closed，不推进 cursor。
- OpenClaw runtime 缺失时明确抛错，避免 backlog 把未派发消息静默确认为成功；可选 Application 名称查询失败不再阻断 Agent 主链路。
- 只在 Agent 派发与回复投递完成后删除已消费的入站消息；Agent 回复保留在 Gotify，保证离线客户端仍可读取。
- `/gotify/status`、`/gotify/health`、`/gotify/doctor` 改为精确匹配、仅 GET、`no-store`；失败的 health/doctor 返回 503。
- 包与清单版本统一为 2026.7.1，清单补齐入站必需的 `allowedAppId`，移除仓库中的旧 `.tgz`。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/gotify test`：11 个测试文件、116 个测试通过。
- `pnpm --dir extensions/gotify typecheck`、`build`、`npm pack --dry-run`：通过；安装包 15 个文件，包含双语 README 与 2026.7.1 清单。
- `gotify/server:2.9.1` + OpenClaw 2026.7.1 隔离 profile：真实 App Token REST 发布、Client Token WebSocket 入站、`lastInboundAt` 推进和 `/gotify/health` 全部通过。
- E2E 安装改用显式 `plugins.allow` 与 `plugins.load.paths`，本地 message-sdk 以 tarball 实体安装，符合 2026.7.1 插件安全扫描；报告自动脱敏且不再跟踪 token、PID、日志等运行态文件。
- CodeGraph 索引已同步；结构检查不再报告 Gotify 的 committed-tgz 错误。

正式环境验收还需验证反向代理/TLS、WebSocket 断线恢复、停机 backlog、离线客户端回复可见性，以及多实例下由外部共享幂等/单活消费策略保障不重复触发 Agent。

## Router 当前交付

- Hook 对齐 OpenClaw 2026.7.1：入站/出站使用 `message_received`、`message_sent`，Agent 回复使用真实带 payload 的 `reply_payload_sending`，不再误用无正文的 `reply_dispatch`。
- 投递使用第三方插件可调用的 `runtime.channel.outbound.loadAdapter`，不再使用不存在的 `publishInbound`，也不误用仅 bundled/trusted official 可调用的 Gateway RPC。
- 同一事件的全部 action 使用 `enqueueBatch` 一次原子进入 Outbox；Hook 只等待可靠落盘，实际投递在后台有界并发执行。
- 投递具备超时、指数退避、持久去重和 DLQ；稳定任务 ID 通过 outbound `deliveryQueueId` 传给目标适配器。Broker 直达使用显式 `openclaw-direct-topic:v1:` target 契约，避免把 OpenClaw 普通 durable reply 的通用 `deliveryQueueId` 误判成直达投递并绕过 session/replyTopic/ACL。
- JSON 文件状态采用 copy-on-write、文件与目录 fsync、结构/version 校验；持久化失败不会污染内存状态。
- 状态目录使用跨进程活跃写租约，第二实例 fail-fast；pending、payload、dedupe、audit、DLQ 均有容量边界，DLQ 满时保留 pending 而不静默丢弃。
- `/router/status`、`/router/health`、`/router/audit`、`/router/dlq`、`/router/dlq/replay` 均精确匹配并使用插件鉴权；DLQ 查询默认只返回脱敏摘要。
- 通配符规则、最大跳数、Router 自有投递身份跳过用于降低路由闭环风险；未提供 messageId/runId 的事件使用独立随机身份，不再按时间戳错误合并。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/router test`：4 个测试文件、48 个测试通过，覆盖批量先落盘、同 run 多段/相同正文回复、重启去重、并发投递、永久悬挂超时、重试/DLQ/replay、双写实例拒绝，以及 rename 已提交但目录 fsync 失败时不重复入队。MQTT、Web-MQTT、RabbitMQ、Redis Stream、RocketMQ 另有回归测试证明普通 core durable reply 仍走原会话路由。
- `pnpm --dir extensions/router typecheck`、`build`、`npm pack`：通过，包与清单版本为 2026.7.1。
- OpenClaw 2026.7.1 隔离 profile + `gotify/server:2.9.1`：预置持久 Outbox 在 Gateway 启动后恢复，经 public channel outbound adapter 真实发送到 Gotify，并由 Gotify Client API 反查到准确正文；Router health 与 Gotify REST/WebSocket E2E 均通过。
- E2E 同时验证普通第三方插件调用 Gateway `send` RPC 会被宿主拒绝，防止后续回退到“类型存在但运行时无权限”的错误实现。

正式环境验收还需验证高积压 I/O、磁盘满/只读文件系统、长时间租约心跳、目标渠道故障恢复和进程强杀后的重复窗口。当前文件后端是单写、at-least-once，不是分布式 exactly-once；多 Gateway 主动-主动路由应改接外部事务存储或明确 Leader。

## Bridge 当前交付

- 删除无效的 `api.publishInbound?.(...)` 静默路径，改用 OpenClaw 2026.7.1 公共 `runtime.channel.outbound.loadAdapter`。
- 消息观察从 `agent_end` 全历史扫描改为 `message_received` 与 `reply_payload_sending`，避免重复转发旧历史，并完整覆盖同一 run 的多段回复。
- Broker Topic 使用 `openclaw-direct-topic:v1:` 显式契约；MQTT、Web-MQTT、RabbitMQ、Redis Stream、RocketMQ 的普通 core durable reply 回归测试证明不会因通用 `deliveryQueueId` 绕过 session/replyTopic/ACL。
- outbound adapter 加载、投递与失败重试均被 Hook 等待；配置最大尝试次数、退避、超时和最大载荷。重试复用稳定 SHA-256 delivery ID。
- 插件 ID 与清单统一为 `bridge`，包与清单版本统一为 2026.7.1；未知来源渠道、未知 MQ、空 Topic 前缀及非法 delivery 参数启动即失败。
- 渠道表对齐本地 OpenClaw 2026.7.1：飞书/QQ stock ID 为 `feishu`/`qqbot`；22 条能力记录明确区分 20 个 stock、仓库 WeCom 与外部钉钉连接器，不再把静态清单描述成“已安装/已验收”。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/bridge test`：7 个测试文件、134 个测试通过，新增真实 Hook 载荷、显式直达 target、多段回复唯一 ID、等待重试与 fail-fast 配置测试。
- `typecheck`、`build`、结构检查、`npm pack`：全部通过，结构检查 0 issue。
- OpenClaw 2026.7.1 隔离 state 安装 tarball：`plugins inspect bridge --json` 显示版本 2026.7.1、状态 loaded、Schema 完整；`plugins doctor` 无问题。

Bridge 的重试仍是进程内 best-effort/at-least-once。进程退出会丢失未完成重试，Broker 超时后结果可能未知；需要跨重启恢复、DLQ、审计与回放的业务应使用 Router 持久 Outbox。正式环境还需至少选择一个实际 IM 来源与目标 MQ 做消息正文、身份、Topic、ACL 和重连验收。

## Tracing 当前交付

- 插件 ID、清单和包版本统一为 `tracing` / `2026.7.1`；OpenClaw `>=2026.7.1` 改为必需 peer dependency；清单声明 `activation.onStartup`，确保非 Channel sidecar 被 Gateway 启动索引加载。
- 使用 OpenClaw 2026.7.1 官方 `message_received`、tool、`reply_payload_sending(kind=final)`、`session_end` Hook；不使用需要 `allowConversationAccess` 的 `agent_end`，遵守第三方插件最小权限策略。Hook 只注册一次，并按 Gateway 生命周期动态获取当前后端，避免重启后重复监听或引用已关闭实例。
- 缺少 `toolCallId` 时不再创建无法结束的 span；`durationMs` 在导出前固化。会话提前结束、新消息覆盖旧 trace、工具回调缺失和 30 分钟 TTL 均会实际关闭 orphan span，而不是只删映射。
- 后端收敛为真实可用的 log、File JSONL 和 OTLP/HTTP。原 SkyWalking 实现未把内部 span 转成 SkyWalking span，只调用 agent flush，会静默丢数据，现已删除；需要 SkyWalking 时通过 OpenTelemetry Collector 转发。
- File/OTLP 使用有界缓冲和串行 flush；OTLP 具备完整 endpoint 归一化、超时、有限重试与正确 float 属性编码；File 具备按日文件和默认 7 天保留期。
- `/tracing/status`、`/tracing/traces`、`/tracing/trace` 使用插件鉴权、GET-only、no-store；后端故障时 status 返回 503，并公开缓冲、丢弃量、最近导出与错误摘要。
- 配置 Schema 与运行时双重 fail-fast 校验；采样率、span/缓冲容量、保留期、flush、超时和重试均有明确范围。消息正文捕获保持默认关闭，最多截取 500 字符。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/tracing test`：5 个测试文件、29 个测试通过，覆盖 Hook 生命周期、final reply 完成语义、orphan 清理、后端失败回收、duration 顺序、配置拒绝、OTLP URL/浮点属性、缓冲溢出、File JSONL 和认证路由行为。
- `typecheck`、构建、结构检查和 pack 均通过，结构检查 0 issue；子目录冗余 lockfile 与伪 SkyWalking 依赖已从发布面删除。
- OpenClaw 2026.7.1 隔离 state 的真实 tarball 安装、持久插件索引刷新和 Gateway 启动通过；索引识别 `startup.sidecar=true`，Gateway 只加载 tracing，公开 Hook 无会话权限告警，带 Bearer 鉴权的 `/tracing/status` 返回 200、`no-store` 与 healthy 后端状态，SIGINT 关闭时后端完成 flush/shutdown。

Tracing 的 File/OTLP 缓冲仍是进程内 best-effort，不是持久 Outbox 或 exactly-once。进程崩溃会丢失尚未 flush 的 span，OTLP 超时存在结果未知窗口。正式环境还需接入实际 OpenTelemetry Collector，验证 Collector 认证/TLS、长时间故障恢复、容量告警、敏感数据策略和目标 APM 的 trace 呈现。
