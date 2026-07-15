# OpenClaw Plugins 生产优化计划

更新时间：2026-07-16  
目标 OpenClaw：2026.7.1

## 基线说明

- `nacos`、`wecom`：用户已在上一版本的真实环境验证。后续只做 2026.7.1 回归、兼容性和发布门禁，不优先重构。
- 其余 26 个插件：按安全风险、共享影响面、数据可靠性、外部渠道依赖的顺序逐个优化。
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
| 11+ | 其余插件 | 按 MQ、业务渠道、观测、RAG、共享组件依次推进 | 待处理 |

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
