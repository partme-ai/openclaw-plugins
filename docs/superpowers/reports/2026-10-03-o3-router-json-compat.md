# O3 Router 普通 JSON 兼容修复

日期：2026-10-03。事实源：[后续功能优化规格的 O3 协议边界](../specs/2026-09-29-openclaw-followup-optimization.md)。本修复属于既有 O3，不另建第二套规格或任务。

## 回归与验收

全分支独立源码复审发现：Router 启用 `structured.enabled` 后，只要普通消息 JSON 带 `schemaVersion` 就调用 `parseStructuredWire`。输入 `{"schemaVersion":1,"description":"ordinary JSON business message"}` 在旧版本会当文本入队，修复前却抛出 `invalid structured wire parts`，未转发。

验收要求：普通业务 JSON 保持原文本；明确带 `format: "structured-v1"` 的 wire 严格解析，无效版本/字段明确拒绝；为兼容已发送的 O3 wire，无标记但具备 `schemaVersion`、`messageId`、`deliveryId`、`parts` 四字段的完整对象仍可解析。SDK 新发出的结构化 wire 加显式格式标记，旧 envelope、legacyJsonText、plainText 的默认行为与字节不变。

## 实施与验证

实施代理先写失败测试，确认普通业务 JSON 被误解析、明确标记缺字段被误按文本处理、SDK wire 缺标记；再修改 Router 识别条件和 SDK 结构化序列化。原独立源码审查代理复核原始输入、旧完整 wire 和显式无效 wire，结论 **Spec PASS / Quality APPROVE**，先前 Important 已关闭。无标记完整 wire 与普通业务 JSON 恰好同形时仍有语义歧义，这是保持既有 O3 生产者兼容的取舍。

父代理独立顺序执行：message-sdk `test` **538/538**、`typecheck`、`build`；Router `test` **83/83**、`typecheck`、`build`，均退出 0。`pnpm pack` 同时通过 message-sdk 消费者契约（94 个源码文件、16 个子路径、151 个命名符号）和 OpenClaw 2026.9.6 的 12 个 runtime 符号核验。真实 installed-host 场景仍须在固定提交和新候选包上重跑。

## 本地候选包许可

原始归档与审计保留在本地忽略目录 `scripts/e2e/reports/candidates/o3-json-compat-20261003/`：Router tgz SHA256 `fff94cf4cb2e5df77272888b2a5a4b0f5752a0e95f65b7be191a24d887ad460f`、包内容摘要 `edf9cac450893b8709d3b02aa4d67ccf32f6e53dcbb4c29ca2f7687d65b8eccb`；message-sdk tgz SHA256 `21e4de18a27c03635e72028b037978cf0198e82c63f073c21b0702c377e3f442`。独立候选审查核对 tar 成员安全/唯一、身份、Router 空 capabilities、依赖和构建文件对应（Router sourcemap 6/6，SDK 201/201），只批准更新 Router 的**本地 E2E 安装许可 pin**。此批准不代表厂商实网或生产发布。

对其余 27 个插件预先 build+pack，`scripts/e2e/reports/candidates/o3-json-compat-preflight-20261003/audit.json` 显示 25 个摘要匹配、另 2 个变化；没有构建或归档安全失败。独立审查后仅追加批准 MQTT `0be3380dee5f518639dbbe2716c52bb3cc96344b31f3443bd53a4fe195c5c9d0` 与 Douyin `9e5697f6ec846266045e11ad80329dc7c28668037cf9ba6fae93fbbede2bb07b` 的本地 E2E pin。MQTT 执行代码仅随共用 SDK 增加结构化 `format` 输出；Douyin 执行代码行为未变，仅 sourcemap/chunk 引用变化。两包身份、capabilities、依赖及安全归档检查通过；MQTT 92 项测试通过、1 项因未配置 Redis URL 跳过，Douyin 104/104 通过。此单测跳过与安装态 E2E 零跳过是不同门禁，不混同。

公共 SDK 源码和 E2E pin 改动会使旧 27 插件安装态报告的输入指纹失效；必须在修复后的固定提交上刷新全部证据后，才能再次声称最终本地门禁通过。
