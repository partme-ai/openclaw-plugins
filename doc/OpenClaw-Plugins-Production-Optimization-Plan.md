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
| 3 | mqtt | 统一 ACL、连接接管、发布前策略与真实 QoS/TLS 契约 | 已完成代码、本地 Redis/TLS E2E 与 2026.7.1 安装验证，待环境验收 |
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
| 18 | prometheus | 官方 metrics/health 路由、指标基数与鉴权边界 | 已完成代码与本地契约验证，待真实监控环境验收 |
| 19 | knowledge | RAG 存储隔离、持久化、ACL、检索质量与真实安装态 | 已完成代码、本地 Gateway 与归档安装验证，待真实数据环境验收 |
| 20 | amap | 删除伪渠道，收敛为高德地点搜索 2.0 capability | 已完成代码、归档安装验证，待真实 Key 环境验收 |
| 21 | meituan | 删除伪渠道与猜测接口，按官方 MTOp 通用协议实现白名单工具 | 已完成代码与协议测试，待真实应用环境验收 |
| 22 | rednode | 删除伪渠道，按官方 Ark 协议实现白名单工具与写操作确认门 | 已完成代码与协议测试，待真实沙箱验收 |
| 23 | wechat-ipad | 非官方外部桥接风险确认、生命周期、边界与真实安装态 | 已完成代码与本地桥接测试，待隔离账号验收 |
| 24 | wechat | iLink 游标可靠性、HTTP/CDN 边界、隐私日志与 2026.7.1 安装态 | 已完成代码与本地门禁，待真实扫码账号验收 |
| 25 | wecom-kf | OpenClaw 运行时契约、KF 回调安全、游标可靠性与控制面隐私 | 已完成代码与 2026.7.1 启动验证，待真实企微 KF 环境验收 |

目录对账：除 `_template` 外共有 28 个扩展；上表 25 个、已由用户验证的 `nacos`/`wecom` 两个基线，以及共享 `message-sdk`，已全部纳入本计划。当前没有遗漏的独立插件。

## 当前自动化安装态矩阵

2026-07-16 使用 OpenClaw 2026.7.1 隔离 profile，将本仓库 tarball 与本地 `message-sdk@2026.7.1` 安装到真实插件目录后，以下 9 个协议/路由适配器在同一 Gateway 组合运行中全部通过：

| 适配器 | 自动化证据 |
|---|---|
| router | 持久 Outbox 恢复，经公开 channel outbound adapter 投递到 Gotify |
| mqtt | `/mqtt/status` 与真实 MQTT publish |
| rabbitmq | AMQP publish、健康端点、Docker Broker 集成；manifest 工具契约覆盖 `mq.publish` / `mq.request` |
| rocketmq | Topic 初始化、Producer send、健康端点；一次性 Producer 子进程隔离上游 SDK 关闭缺陷 |
| redis-stream | `XADD`、`XREADGROUP`、`XACK` 与健康端点 |
| gotify | REST publish、WebSocket inbound 与健康端点 |
| stomp | STOMP 1.2 TCP `SEND` 与状态端点 |
| web-mqtt | WebSocket MQTT publish、状态端点，以及真实 Chromium 连接/订阅/发布 |
| web-stomp | WebSocket STOMP `SEND`、状态端点，以及真实 Chromium 连接/订阅/发送 |

该矩阵还覆盖 Node 24 并行插件加载、Gateway 启停清理、浏览器 Origin 白名单和浏览器失败的非零退出传播。它证明上述 9 项的本地安装态与协议链路，不等同于正式生产环境验收。其余 19 个扩展按各自章节的本地门禁与外部前置条件验收；其中 `nacos`、`wecom` 的真实环境证据来自用户上一版本验证，仍需补 2026.7.1 回归。正式域名/TLS、真实平台账号、HA/故障切换、容量压测和长稳运行未完成前，不统一标记为“生产就绪”。

此外，`web-socket` 作为第 12 个 E2E adapter 在隔离的 host Gateway 场景单独通过。E2E 安装器现在会把解包后的本地 tarball 通过 OpenClaw `plugins install --link` 写入 2026.7.1 的 installed-plugin index，避免尚未发布到 npm 的插件被启动迁移误判为缺失并触发在线修复。

## Message SDK 当前交付

- 包版本升级为 2026.7.1；21 个公开子路径的运行时与类型入口全部指向编译产物，不再让安装态消费者直接执行 TypeScript 源码。
- `prepack` 强制执行全入口构建和动态 import 校验，缺失入口、源码运行时入口或不可导入入口会阻断打包。
- `IdempotencyCache` 增加显式释放；`InboundMessageQueue` 先检查容量再预占幂等键，`onPush` 失败时原子回滚队列项与幂等记录。
- `InboundMessageQueue` 对容量配置 fail-fast；`OutboundMessageQueue` 增加跨 session 总容量限制、溢出回调和准确总量统计。
- 公开声明显式引用 Node 类型，并声明必需的 `@types/node` peer，兼容 pnpm 隔离依赖布局。

本地门禁（2026-07-16）：

- `pnpm --filter @partme.ai/openclaw-message-sdk test`：54 个测试文件、392 个测试通过。
- 类型检查、21 入口构建和 package export verifier 全部通过。
- 将 `2026.7.1.tgz` 安装到空白目录后，普通 Node.js 成功 import 21 个入口；严格 TypeScript 消费项目在 `skipLibCheck=false` 下通过。

环境验收仍需在主要消费者插件完成版本矩阵回归，并对大消息、高并发、磁盘故障和进程崩溃执行压力/故障演练；进程内队列本身不宣称持久化。

## mTLS 当前交付

- 包与 manifest 版本升级为 2026.7.1，OpenClaw peer 下限为 `>=2026.7.1`。
- 独立 HTTPS/mTLS 反向代理，不再伪装为 `registerHttpRoute` 全局中间件。
- manifest 声明 `activation.onStartup=true`，确保 `registerService` 在 Gateway 启动阶段执行，而不是只在延迟 agent-runtime 预热时加载。
- TLS 1.2+、CA 客户端证书校验、CN/issuer/fingerprint 白名单。
- HTTP 和 WebSocket Upgrade 转发。
- 覆盖客户端伪造的 trusted-proxy 身份、`Forwarded`、`X-Forwarded-*` 与 `X-Real-IP` Header，并只重建可信转发链。
- `/mtls/status` 不再由代理匿名短路，统一转发到 OpenClaw 的 `auth: "gateway"` 路由；默认受 mTLS 路径策略保护。
- 公开路径上的证书只有通过 CA 校验和 `allowedClients` 后才会获得身份，避免借公开路径绕过客户端白名单。
- 移除不属于 OpenClaw 2026.7.1 trusted-proxy 契约的 `x-openclaw-scopes` 注入；Header 名、路径规则和白名单项 fail-fast 校验。
- WebSocket 隧道纳入生命周期跟踪，插件停止时主动关闭，避免 Gateway 优雅退出悬挂。
- 未配置默认禁用；启用但证书缺失时 fail closed。
- 启动时校验 OpenClaw `trusted-proxy` 模式、`userHeader`、`allowLoopback`、`trustedProxies` 与 Gateway 端口；只允许回源本机 `127.0.0.1`/`::1` Gateway。
- 禁止 `passthrough=true`、`requestCert=false`、`rejectUnauthorized=false`，公开路径只能通过显式路径规则声明。
- 清理 hop-by-hop 及 `Connection` 指定 Header，阻止代理 Header 走私；WebSocket Upgrade 仅重建必需 Header。
- 真实 OpenSSL CA/服务端/客户端证书集成测试。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/mtls test`：2 个测试文件、19 个测试通过。
- `pnpm --dir extensions/mtls typecheck`：通过。
- `pnpm --dir extensions/mtls build`：通过。
- 严格结构检查：0 error、0 warning。
- 根工作区 `pnpm typecheck`、`pnpm test:unit`、`pnpm build`：通过，构建覆盖 30 个工作区包。
- `2026.7.1.tgz` 安装到隔离的 OpenClaw 2026.7.1 状态目录后，`plugins inspect mtls` 为 loaded，`plugins doctor` 无问题。
- 统一 E2E `--plugins mtls` 从 tarball 安装后，用临时 OpenSSL CA 验证无证书 401、非受信 CA 证书 401、受信证书 200，并由 OpenClaw 2026.7.1 `trusted-proxy` 完成 `/mtls/status` 鉴权；该安全场景与九插件默认组合隔离运行。

环境验收时还需使用真实域名证书启动 Gateway，执行 `openclaw security audit`，确认 Gateway 上游端口未直接暴露，并验证证书轮换、吊销、过期、CA 切换和长连接排空策略。

## OAuth2 当前交付

- 包与 manifest 版本升级为 2026.7.1，OpenClaw peer 下限为 `>=2026.7.1`。
- 独立 Bearer Resource Server HTTP/WebSocket 反向代理，接入 OpenClaw `trusted-proxy`。
- manifest 增加 `activation.onStartup`，确保非 channel 的代理服务随 Gateway 启动。
- 仅使用 `openid-client` 实现标准 OAuth2/OIDC Authorization Code Client：Discovery、PKCE、token、userinfo、introspection、refresh、revoke 全链路。
- 支持显式配置授权、Token、UserInfo、Introspection、Revocation 端点，以及 `client_secret_post`、`client_secret_basic`、公共客户端。
- 非 loopback issuer 与端点强制 HTTPS；Bearer Token 只允许通过 Authorization Header 传入。
- 启动前强校验 Gateway 的 `trusted-proxy` 模式、身份 Header、`allowLoopback`、`trustedProxies` 与端口；上游仅允许本机 loopback Gateway。
- 覆盖伪造的 forwarded/user/tenant/scope headers，并清除 hop-by-hop 与 `Connection` 指定头，只重建可信身份和转发链；不再注入 OpenClaw 2026.7.1 不识别的 `x-openclaw-scopes`。
- 删除无效的 viewer/operator/admin 映射，改为 `requiredScopes` 代理准入；Gateway 权限仍由 OpenClaw trusted-proxy 与 `allowUsers` 负责。
- HttpOnly/SameSite 会话、先验签后一次性消费 state、站内 returnTo 校验；logout 仅允许 POST，避免 GET CSRF。
- 内存 state/session store 增加容量上限，异步 handler 失败返回有界 503；同进程并发 refresh 使用 session 单飞，刷新后重新校验身份与 `requiredScopes`，避免重复使用旋转型 refresh token 或沿用已收窄权限。
- `/auth/oauth2/status` 不再由代理匿名短路，统一转发到 OpenClaw `auth: "gateway"` 路由。
- Redis 后端支持共享 state/session/token 和原子 `GETDEL` state；跨实例条件测试已具备，当前环境未配置 `TEST_REDIS_URL`，因此不把真实 Redis 计为已验收。

本地门禁（2026-07-16）：

- `pnpm --filter @partme.ai/openclaw-oauth2 test`：5 个测试文件、15 个测试通过；1 个真实 Redis 条件测试因未配置 `TEST_REDIS_URL` 跳过。
- 类型检查、构建、严格结构检查通过（0 error、0 warning）。
- 本地标准授权服务器完整覆盖 Discovery、Authorization Code + PKCE、UserInfo、并发 Refresh、Revocation；显式端点覆盖 Bearer Introspection 和 WebSocket。
- `2026.7.1.tgz` 安装到隔离 OpenClaw 2026.7.1 后，统一 E2E 使用标准 OAuth2 服务完成 Authorization Code + PKCE、短期 Token 自动刷新、Introspection、Bearer、Revocation、伪造身份覆盖，并穿过 OpenClaw `trusted-proxy`/`allowUsers`，结果 PASS。

环境验收需要接入至少一个真实标准 OAuth2/OIDC Server 和 Redis，验证真实 Discovery/JWKS/issuer 行为、自定义身份字段、授权 Scope、旋转 refresh token、多实例刷新竞争、吊销传播、授权服务器故障策略和 TLS 终止链路。

## Douyin 当前交付

- Webhook 使用常量时间比较校验 `SHA1(app_secret + rawBody)`，同时校验事件 `client_key`。
- `verify_webhook` 按官方协议返回 JSON challenge；普通事件兼容 object 和 JSON 字符串两种 `content`。
- 强制普通事件携带 `Msg-Id`；按账号使用 24 小时/10000 条持久化 claim/commit/release 去重，只有成功派发才提交，失败和超时释放后可重试。
- 回调快速返回成功后异步派发，满足官方 5 秒连接窗口；但“ACK 成功后进程立即崩溃”的事件仍可能丢失，严格可靠场景后续需增加持久化 inbox。
- `client_token` 使用按凭据隔离的本地缓存、并发请求合并和提前刷新，平台 Token 失效时仅刷新对应账号。
- `douyin_query_orders` 已对接官方 `GET /goodlife/v1/trade/order/query/`，校验分页上限并支持 cursor/订单/状态/时间筛选。
- `douyin_reply_review` 已对接官方 `POST /goodlife/v1/akte/comment/reply/`，使用 `account_id`、`poi_id`、`rate_id`、`text` 正式参数。
- OpenAPI 使用官方 `access-token` 与 `Rpc-Transit-Life-Account` Header，平台错误不再伪装为空数据成功；Token/OpenAPI JSON 响应限制为 2 MiB，只对安全查询执行带退避的有限重试。
- 命名账号自动派生独立 Webhook 路径，显式重复路由启动失败，不再通过 `replaceExisting` 静默覆盖其他账号处理器。
- 生活服务 Webhook 没有对称私信 API，通用 `sendText` 和 Agent 回复不再返回虚假送达结果。
- 清单版本与包版本对齐，配置 Schema 补齐多账号、商户、POI、超时和安全字段。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/douyin test`：10 个测试文件、75 个测试通过。
- `pnpm --dir extensions/douyin typecheck`：通过。
- `pnpm --dir extensions/douyin build`：通过。
- 归档安装到独立 `OPENCLAW_STATE_DIR` 后，OpenClaw 2026.7.1 `plugins doctor` 无问题，`plugins inspect douyin` 显示版本 2026.7.1，`channels list --all` 可识别抖音渠道。

环境验收还需使用已获 `life.capacity.order.query`、`life.capacity.catering.comment` 和评价回复权限的真实生活服务应用，验证 HTTPS Webhook、重复投递、订单查询、Token 轮换及评价回复。

## AMap 当前交付

- 删除没有真实平台协议支撑的 channel、Webhook、setup 和始终返回成功的占位出站。
- 收敛为三个高德地点搜索 2.0 工具：文本搜索、周边搜索、POI 详情。
- 使用 `AMAP_WEB_SERVICE_KEY` 注入凭据；请求只允许固定 API 路径，基址强制 HTTPS（回环测试除外）。
- 增加参数与经纬度范围校验、请求超时、响应大小上限、业务错误识别、有限重试、进程内配额和可选 owner-only。
- 移除 message-sdk 运行时依赖，插件配置与包版本对齐 OpenClaw 2026.7.1。

环境验收还需使用真实高德 Web 服务 Key 验证配额、地点搜索结果、429/平台错误和多实例统一限流策略。

## Meituan 当前交付

- 删除没有真实对称消息协议支撑的 channel、Webhook、setup、message-sdk 依赖和始终返回成功的占位出站。
- 删除猜测的 `/open/order/list`、`/open/review/reply` 等接口，不再把未经业务授权和协议验证的路径宣称为已实现。
- 按官方 `MtOpJavaSDK` 通用协议实现表单 POST：`biz`、`businessId`、`developerId`、`timestamp`、`charset`、`version`、`appAuthToken`。
- 签名与官方 SDK 对齐：`signKey + 按 key 排序拼接非空 key/value` 后计算 SHA-1。
- API 路径和 `businessId` 必须通过 `operations` 显式白名单配置；Agent 不能自由输入 URL。
- 默认 owner-only，增加 HTTPS 基址约束、请求/响应体上限、超时和进程内限流；不自动重试 POST，避免核销/退款等写操作重复执行。
- 插件与清单版本对齐 OpenClaw 2026.7.1，移除运行时依赖。

环境验收还需使用已审批的真实美团应用，在开发者中心复制目标业务的真实 API 路径与 `businessId`，完成门店授权后验证 `appAuthToken`、`OP_SUCCESS`、traceId、平台限流以及只读/写操作权限。多 Gateway 的集中限流和高风险写操作审批仍需由部署侧补充。

## Rednode 当前交付

- 删除并不存在的“小红书聊天渠道”、Webhook Agent 回复链路、伪成功出站和 message-sdk 依赖。
- 删除非官方的 `/api/order/list` 等猜测接口以及错误的 `open.xiaohongshu.com + HMAC-SHA256` 调用方式。
- 按小红书官方 Ark 协议实现：生产网关 `https://ark.xiaohongshu.com`，Header 携带 `timestamp`、`app-key`、`sign`，Body 使用 JSON。
- MD5 签名已逐字节复现官方公开示例；签名输入为 API 路径、排序后的 query/Header 参数和 app-secret。
- 支持 GET、POST、PUT 和安全路径模板；API 只能来自 `operations` 白名单，POST/PUT 额外要求 `confirm=true`。
- 默认 owner-only，具备超时、请求/响应体上限、业务错误识别和进程内限流；版本对齐 OpenClaw 2026.7.1。

环境验收还需先申请官方沙箱，使用真实 app-key/app-secret 验证 401/403、商品/订单只读接口，再逐项验证上下架、发货等写操作。多 Gateway 集中限流与高风险操作审批仍需由部署侧提供。

## WeChat iPad 当前交付

- 明确收窄为“用户自行运营的外部非官方桥接服务”，插件不实现或分发 iPad 底层协议。
- 默认 `enabled=false`；启用时必须显式设置 `acknowledgeUnofficialProtocolRisk=true`，否则配置校验失败。
- 已改用 OpenClaw 2026.7.1 `defineChannelPluginEntry`、`ChannelOutboundAdapter` 和可停止 `registerService` 契约，删除全局信号处理和启动降级兼容分支。
- WebSocket 与 HTTP Token 使用 Bearer Header，不再放入 URL；远程端点强制 WSS/HTTPS，仅回环地址允许明文协议。
- 增加连接/请求超时、WS/HTTP 响应上限、心跳 pong 超时、带抖动的指数退避、入站去重和文本上限。
- 群消息默认关闭；开启时必须配置非空白名单，或再次显式确认 `allowAllGroups=true`。
- 删除会泄露 wxid 的会话列表端点；剩余状态端点使用 exact 匹配和 Gateway 认证，只返回脱敏状态。
- 包与清单版本已对齐 2026.7.1，移除 `clawdbot` / `moltbot` 历史 peer dependency。

本地门禁（2026-07-16）：TypeScript、50 个测试（含真实本地 WebSocket + HTTP 回环与 OpenClaw 注册契约）已通过。环境验收仍需使用隔离微信账号与真实外部桥接服务，验证登录、Token 失效、私聊收发、白名单群、重复投递、长时间心跳、桥接/Gateway 重启与账号风险控制；完成前不标记为生产就绪。

## WeChat 当前交付

- 包、插件/Channel ID 和版本对齐为 `@partme.ai/weixin`、`openclaw-weixin`、`2026.7.1`，安装元数据不再指向上游包；仓库保留历史目录名 `extensions/wechat`，结构检查器为该外部规范 ID 设置显式映射。
- `get_updates_buf` 改为整批消息全部处理成功后才持久化；失败时不推进游标，保证至少一次语义，避免批次中途故障造成后续消息永久跳过。
- 成功处理的 `message_id` 以 7 天/10000 条有界 JSONL 追加日志持久化，批次重放与进程重启时跳过已完成消息；压缩采用同目录临时文件原子替换，文件权限限制为 0600，避免每条消息重写整个去重集合。
- 服务端长轮询超时限制在 1–60 秒；普通 GET 默认 15 秒超时，全部定时器可释放进程。
- API 响应最大 2 MiB，CDN/远程媒体最大 100 MiB；远程下载强制 HTTPS、拒绝常见 loopback/私网字面地址，并设置 30 秒超时。
- API/CDN 非 2xx 错误不再回显响应正文；日志删除消息正文、同步游标、用户 ID、token 前缀、文件路径、签名参数和错误堆栈。
- Channel 配置 Schema 改为拒绝未知字段，API/CDN 基址强制 HTTPS，支持 section/account 级基址与多账号配置。

本地门禁（2026-07-16）：26 个测试文件、346 个测试通过，覆盖游标提交失败语义、持久去重、超时钳制、响应大小和错误脱敏；TypeScript 通过。真实生产验收仍需用隔离微信账号完成扫码、凭据刷新、文本/媒体双向收发、断网重投、Gateway 强杀恢复和多账号会话隔离。当前是 at-least-once；插件能抑制已持久化完成记录的重放，但进程在回复成功、写入完成记录前崩溃仍可能重复回复，严格业务仍需下游幂等；完成真实账号验收前不标记为生产就绪。

## Memory 当前交付

- 按 Agent 哈希目录和 session 双重物理隔离数据；会话目录名由本机 256-bit 随机密钥 HMAC 生成 128-bit opaque capability，补齐 OpenClaw `readFile()` 不携带 `sessionKey` 的宿主契约缺口。只有显式设置 `profileScope: "agent"` 的单用户 Agent 才允许 L3 跨 session 召回。
- `agent_end` 只保存当前轮消息，使用 `runId` 做持久化幂等，避免每轮重复写入完整历史。
- L0/L1/L2/L3 均有真实数据模型：当前轮、情景记忆、周期场景、明确偏好/身份/长期指令画像。
- 全部文件 I/O 改为异步，同一 JSONL 文件写入串行化；服务停止前排空队列。
- `retentionDays` 在启动时和每日生效；过期的对话、情景、场景和画像文件会自动删除。
- Agent 工具使用 OpenClaw 可信 `agentId`/`sessionKey` 上下文；缺少 sessionKey 时 fail-closed，拒绝目录穿越和旧版可枚举路径，且禁止读取 L0 原始对话。
- 可通过 `encryptionKeyEnv` 启用 AES-256-GCM 逐行静态加密；密钥值至少 32 字节，缺失或错误时启动失败，不再把解密失败静默表现为空记忆。
- `maxRecordBytes` 同时约束 L0 和批量 L1/L2/L3；配置数值要求合法整数，不再静默夹逼或截断。
- 首次启动自动把旧版按日混合目录拆分进会话目录，并保留 `.legacy-backup`；重启后 status 会重新发现磁盘文件。
- OpenClaw 2026.7.1 对非内置 `agent_end` 强制显式信任：配置必须包含 `plugins.entries.memory.hooks.allowConversationAccess=true`。插件在缺失时会明确告警，避免 `loaded` 但不产生新记忆的假健康状态。
- 明确标注为本地词法检索，不宣称向量或语义能力；多节点共享记忆交由 OpenMem 等外部后端。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/memory test`：1 个测试文件、28 个测试通过，覆盖物理会话隔离、fail-closed 搜索、错误密钥、记录上限、重启状态和旧目录迁移。
- `pnpm --filter @partme.ai/openclaw-memory typecheck`：通过。
- `pnpm --dir extensions/memory build`：通过。
- 最终 `.tgz` 已由 OpenClaw `2026.7.1 (2d2ddc4)` 安装；`plugins info memory` 显示 `Status: loaded`、`Version: 2026.7.1`、`allowConversationAccess: true`。真实 Gateway 启动日志显示 memory 注册且服务 ready，没有再出现 conversation hook blocked。

环境验收还需在真实 OpenClaw Gateway 上验证自动注入、群聊 session 的共享边界、进程重启幂等、备份恢复、90 天清理及大文件/高并发磁盘压力。当前静态加密不支持在线密钥轮换，轮换前应离线导出或重加密旧数据；完成这些验收前不标记为生产就绪。

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
- 容量门禁移到 clientId 已解析的认证阶段；满容量时允许同 clientId 安全接管，旧连接断开不会清除新连接的身份和状态。
- payload 大小与 retain 策略在 Aedes 转发给订阅者之前拒绝；异步 OpenClaw 入站处理被真实等待，异常不会形成未处理 Promise rejection。
- 删除未接入协议链路的伪 QoS ACK/retry handler；QoS 0/1/2 由 Aedes/MQTT 协议栈处理，插件只对 QoS0 OpenClaw 分发链路实施有界背压。
- `/mqtt/status` 改为 exact 路由并仅输出脱敏配置摘要，不再泄露 MQTT/Redis 密码、证书路径或持久化端点。
- 删除未实现的 `wsPort` 与未使用的 `ws` 依赖；浏览器 WebSocket MQTT 由独立 `web-mqtt` 插件承担。
- TCP、TLS、Aedes、Redis 的启动失败回滚与异步关闭均等待资源真正释放。
- Redis 持久化使用正确的 `conn` / `packetTTL` 契约；MQEmitter 使用独立 Pub/Sub 连接和集群前缀，避免共享 Redis 时跨环境串消息。
- 插件清单补齐 `host`、`tls.port`、`packetTTL` 并拒绝未知根配置。
- 文档按 Aedes 真实能力修正为 MQTT 3.1/3.1.1；MQTT 5.0 当前不支持。

本地门禁（2026-07-15 至 2026-07-16）：

- `TEST_REDIS_URL=redis://127.0.0.1:16379 pnpm --dir extensions/mqtt test`：10 个测试文件、57 个测试通过，包含真实 Redis 8.4。
- `pnpm --dir extensions/mqtt typecheck`：通过。
- `pnpm --dir extensions/mqtt build`：通过。
- 2026-07-16 回归：11 个测试文件、65 个测试通过，1 个 Redis 条件测试因本轮未提供 Redis 而跳过；新增真实 OpenSSL TLS + QoS2、同 clientId 接管、发布前拒绝、启动回滚、异步异常与状态脱敏覆盖。
- `pnpm pack` 产物已由 OpenClaw `2026.7.1 (2d2ddc4)` 从 `.tgz` 安装；`plugins info mqtt` 显示 `Status: loaded`、`Version: 2026.7.1`，Doctor 插件统计 `Errors: 0`。

环境验收还需在两台 Gateway 进程上验证 Redis 跨节点 QoS/订阅传播、TLS 设备证书、断网重连、Redis 故障恢复、连接上限和高负载背压。

## Web-MQTT 当前交付

- 明文 WS 默认仅监听 `127.0.0.1`；非 loopback 必须同时启用 WSS 与客户端认证。
- 认证用户使用实际认证映射参与 ACL；未知用户、无规则用户和匿名用户均 fail closed。
- 匿名访问必须显式配置 `anonymous` 用户及 ACL。
- `maxConnections` 和 `maxSubscriptionsPerClient` 现在是实际运行时上限。
- Aedes 连接身份、订阅集合和在线所有权绑定实际 Client 对象；同 clientId 接管后，旧连接断开不会清除新连接状态。
- payload 大小在 Aedes 转发给订阅者前拒绝，避免“OpenClaw 不处理但 broker 已向浏览器广播”的策略绕过。
- 浏览器 `Origin` 使用精确白名单，未列出的 Origin 在 WebSocket 握手阶段返回 403；原生客户端可不发送 Origin。
- 默认关闭 WebSocket 压缩，降低不可信载荷的压缩资源消耗；帧上限与 MQTT payload 上限保持一致。
- WSS 缺少 key/cert、未实现的 PROXY Protocol、错误的网络暴露配置均启动 fail-fast。
- 启动失败回滚、WebSocket client terminate、HTTP(S)/Aedes 关闭均等待完成。
- 未显式配置 `channels.mqtt-ws.port/path` 时不再自动声明默认账号；已 abort 的 Gateway 生命周期不会永久挂起。
- `/mqtt-ws/status` 使用 exact 路由，只输出用户数量和 TLS 状态等脱敏摘要，不暴露用户名、密码或证书路径。
- manifest 的插件配置 schema 与 `channelConfigs.mqtt-ws.schema` 已分离，OpenClaw 可在插件运行前正确校验渠道配置。
- 清单版本与包版本对齐，修复 npm 打包中错误的 README/RELEASING 文件名。

本地门禁（2026-07-15 至 2026-07-16）：

- `pnpm --dir extensions/web-mqtt test`：13 个测试文件、54 个测试通过，包含真实 OpenSSL WSS 握手。
- `pnpm --dir extensions/web-mqtt typecheck`：通过。
- `pnpm --dir extensions/web-mqtt build`：通过。
- 2026-07-16 回归：14 个测试文件、63 个测试通过；新增发布前超限拒绝、同 clientId 接管、TLS 启动失败回收、预中止生命周期、账号显式配置与深度状态脱敏覆盖。
- 最终 `.tgz` 已由 OpenClaw `2026.7.1 (2d2ddc4)` 安装；`plugins info web-mqtt` 显示 `Status: loaded`、`Version: 2026.7.1`。OpenClaw 对 `channels.mqtt-ws.port=70000` 按插件渠道 schema 正确拒绝。

环境验收仍需验证目标浏览器的真实 Origin、生产证书链、反向代理 Upgrade 配置、断网重连和预期并发负载，因此当前结论仍是“代码与本地协议门禁完成，待环境验收”。

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
- 状态接口继续由 OpenClaw 插件认证保护，并对 token 和客户端 headers 脱敏；路由改为 exact、GET-only、`no-store`，非 GET 返回 405。
- 补齐 LICENSE、中文 README、发布文件和真实 WebSocket transport 集成测试。

本地门禁（2026-07-15 至 2026-07-16）：

- `pnpm --filter @partme.ai/openclaw-web-socket test`：4 个测试文件、20 个测试通过，包含真实 HTTP upgrade 鉴权、Origin 拒绝、query token 拒绝、客户端 Bearer header、异步消息顺序与带活跃连接停机。
- `pnpm --filter @partme.ai/openclaw-web-socket typecheck`：通过。
- `pnpm --filter @partme.ai/openclaw-web-socket build`：通过。
- 最终 `0.1.0.tgz` 与本地 `message-sdk@2026.7.1` 安装到 OpenClaw 2026.7.1 隔离 profile；宿主 installed-plugin index 注册、Gateway 启动和 Channel 生命周期通过。
- 新增统一 E2E adapter：匿名握手 401、Query Token 401、非法 Origin 403、Bearer + 合法 Origin 连接成功；`connected`、`ping/pong`、非法帧错误响应、活动连接状态、状态脱敏和 POST 405 全部通过。

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

## WeCom KF 当前交付

- 对齐 OpenClaw 2026.7.1 `runtime.config.current()` 契约，修复回调、系统事件和事件文案仍把配置 facade 当成配置对象的问题；测试 mock 同步改为宿主真实形态。
- 账号探测从解析后的 `account.config` 读取 KF 凭据；事件文案按 `open_kfid` 反查账号键，避免多账号覆盖失效。
- `eventMessages` 已同步进入顶层、账号快捷字段和嵌套 `kf` 的配置类型，消除运行时已支持但 DTS 契约缺失的漂移；控制面结果统计显式使用数值归约，确保全仓严格类型检查通过。
- 删除重复系统事件处理路径、未实现的 `kf-status` 声明和无法工作的旧 MCP bridge 注册；manifest 顶层插件配置收敛为空，渠道配置只由 `channelConfigs.wecom-kf` 承载。
- 回调签名使用常量时间比较，并拒绝与本机时间相差超过 5 分钟的请求；`msgid` 继续使用 claim/commit/release，只有处理成功才推进游标。
- 游标文件名加入账号键 SHA-256 摘要，避免字符清洗碰撞；兼容读取旧文件名，空/损坏文件 fail closed。游标与会话状态使用临时文件加原子 rename、`0700/0600` 权限，单次写失败不会毒化后续持久化队列。
- 控制面审计日志不再输出企微原始响应、账号 ID、外部联系人 ID、消息 ID、会话键或账号链接，仅保留动作、成功状态、错误码与结果规模。
- `@partme.ai/openclaw-message-sdk` 依赖升级到 `workspace:^2026.7.1`；包、manifest 与 OpenClaw peer 下限均为 2026.7.1。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/wecom-kf test`：32 个测试文件、152 个测试通过，新增真实 runtime facade、账号键映射、探测凭据、回调重放拒绝、游标碰撞/旧格式/损坏失败测试。
- `typecheck`、构建、`--strict-new` 结构检查和 `git diff --check` 全部通过；结构检查 0 error、0 warning，CodeGraph 已同步。
- 组装 message-sdk 与 wecom-kf 两个本地 tarball 到无 workspace symlink 的实体依赖目录后，OpenClaw `2026.7.1 (2d2ddc4)` 显示 `Status: loaded`、`Version: 2026.7.1`；隔离配置校验通过，Gateway 日志显示只加载 `wecom-kf` 并进入 ready。
- 单独安装 wecom-kf tarball 会因默认 npm 源尚无 `@partme.ai/openclaw-message-sdk@2026.7.1` 而失败。发布顺序必须是先发布 message-sdk 2026.7.1，再验证空目录安装，最后发布 wecom-kf；在此之前不能宣称归档可独立部署。

正式环境仍需按 `doc/wecom-kf/Integration-Checklist.md` 验证企微回调 URL、真实 AES 验签解密、`sync_msg` 分页与游标恢复、多账号映射、文本/图片/语音、人工转接、满意度、Token/Secret 轮换、反向代理时间同步和平台重试行为。未完成这些测试前，状态是“代码与宿主兼容门禁通过”，不是“生产验收完成”。

## Knowledge 当前交付

- 默认生产存储收敛为 Node.js 22 内置 SQLite + WAL/FTS5，ZVec 仅作为开发与轻量后端；namespace 表名和持久化文件名使用摘要后缀，避免字符清洗碰撞。
- `VectorStore` 增加 `replaceBySource` 原子替换契约。SQLite 在一个 `BEGIN IMMEDIATE` 事务中同步替换向量行与 FTS 行，任一步失败都会回滚并保留旧文档；ZVec 在完整校验新数据后一次性切换内存快照。
- 文件索引、文本写入、摘要写入以及三类更新路径全部使用原子替换，不再执行可能造成数据丢失的 `deleteBySource → upsert`。
- 同一 Store/sourceId 的完整加载、切块、Embedding 与替换流程按调用顺序串行，不同 sourceId 仍可并发，避免较早请求晚完成后覆盖较新请求。
- Embedding 向量维度与有限值在任何存储变更前校验；SQLite 向量与 FTS 变更保持一致，ZVec 使用 owner-only 临时文件与原子 rename 持久化，并在关闭时 flush。
- OpenAI-compatible、DashScope、智谱、千帆调用增加可配置请求超时、408/429/5xx 与网络错误有限重试、错误正文截断、批量拆分，以及响应数量/index/维度/有限值校验；Ollama 同样实施超时、批量拆分和响应校验。
- Tool 写入实施 account/mode namespace ACL、sourceId 与正文大小上限；文件摄取默认关闭，仅 owner 可用，且 realpath 必须位于显式允许根目录，防止路径穿越与符号链接逃逸。
- RAG Hook 具备输入、topK、上下文块数和 token/字符边界；Store 初始化按 namespace 合并并发请求，Gateway 停止时释放缓存资源。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/knowledge test`：14 个测试文件、130 个测试通过；新增 SQLite 替换失败回滚、ZVec 替换隔离/预校验、同 source 串行与跨 source 并发，以及 Embedding 批量拆分、瞬时错误重试和响应契约测试。
- `pnpm --dir extensions/knowledge typecheck`、`build`、`pnpm pack`：通过；归档版本为 2026.7.1。
- OpenClaw 2026.7.1 隔离 profile 从 tarball 安装后，`plugins info knowledge` 显示 `Status: loaded`、`Version: 2026.7.1`；Doctor 显示 Knowledge Hook 与 4 个 Tool 已注册，插件统计 `Errors: 0`。

正式环境仍需使用实际 Embedding/Reranker/Tokenizer 服务与真实业务文档验证限流、超时、模型维度、召回率、误召回、中文 FTS 效果、数据规模与磁盘故障。当前 SQLite 向量召回仍是进程内全表扫描，适合单机中小规模知识库；大规模或多 Gateway 部署应接入具备租户隔离、ANN、备份恢复和高可用能力的外部向量数据库，不能把当前实现宣称为分布式生产就绪。

## Prometheus 当前交付

- 并发 cache miss 使用 single-flight：即使 `collectIntervalMs=0`，同一时刻的 scrape 也只触发一套底层采集，避免 Prometheus 并发抓取放大 Gateway RPC 压力。
- `collectorTimeoutMs` 为每个 collector 设置 100-60000ms 等待边界；已超时但尚未结束的底层调用会被复用，不会在后续 scrape 中重复创建永久悬挂任务。单个 collector 失败只影响自身 success/diagnostic，不阻断其他指标。
- `maxScrapeSeries` 对最终响应实施 100-50000 系列硬上限，并以 `openclaw_metrics_scrape_series_dropped` 暴露本次省略数；diagnostics 与 runtime store 原有 2048/4096 独立上限继续生效。
- 修复 diagnostics 指标被通用 collector 和原始文本块重复输出的问题；通用 formatter 现在能在一个 histogram HELP/TYPE 下正确输出 `_bucket/_sum/_count`，不会把子系列错误标记为 auto-discovered gauge。
- 渠道指标不再输出自由文本 `channel_label`，channel id/type 统一清洗；collector 与 RPC 原始错误经 OpenClaw 脱敏、控制字符清理和长度限制后才进入 JSON 健康/调试响应。
- Bearer Token 使用常量时间比较；全部 HTTP 路由保持 exact、GET-only、`no-store`。未授权抓取返回 401，配置启用鉴权但缺少 token 时 fail closed 返回 503。
- 发布包修正运维文件清单：删除不存在的 `grafana` 目录声明，实际包含 alerts/config/deploy。高基数告警改为监控三层 dropped-series 指标，不再使用受 4096 上限约束、永远达不到 100000 的无效阈值；Prometheus health JSON 不再被错误配置成 scrape target。

本地门禁（2026-07-16）：

- `pnpm --dir extensions/prometheus test`：9 个测试文件、37 个测试通过；覆盖百路并发 single-flight、永久悬挂 collector 超时/复用、最终系列截断、histogram 单次输出、配置边界、鉴权、运行时 registry 上限与 OpenClaw 注册链路。
- `typecheck`、DTS/ESM 构建、结构检查、`git diff --check` 和 `npm pack --dry-run` 全部通过；归档含 14 个预期文件及完整运维样例。
- OpenClaw `2026.7.1 (2d2ddc4)` 隔离 profile 从最终 tarball 安装并启动 Gateway：只加载 prometheus，13 个 collector 全部 success，`openclaw_up=1`，build info 版本为 2026.7.1，`/metrics/health` 返回 200/healthy 且 RPC initialized；无 Token `/metrics` 返回 401。
- 对运行中的 Gateway 发起 100 路、并发度 25 的真实 HTTP scrape：全部成功，Gateway 日志只出现一组底层 RPC，验证 single-flight 在真实宿主生效；diagnostics HELP 实际只输出一次。
- 官方 `prom/prometheus:v3.5.0` `promtool`：13 条告警规则、发布用 Prometheus 配置和本地配置（含 rule file 解析）全部校验通过。

正式环境仍需在真实 Prometheus/Grafana/Alertmanager 环境验证 TLS/反向代理、Token 轮换、Prometheus HA 双副本抓取、长时间高频 scrape、Gateway RPC 故障、指标保留成本、告警路由和业务阈值。当前 collector 超时无法取消 OpenClaw GatewayClient 已发出的底层 RPC，只能阻止 scrape 等待和重复创建；若宿主未来提供 AbortSignal，应进一步传递取消信号。
