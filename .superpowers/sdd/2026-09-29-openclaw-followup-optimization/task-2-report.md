# O2 组合上下文预算、来源与取消

规格事实源：`docs/superpowers/specs/2026-09-29-openclaw-followup-optimization.md` 的 O2 / 预算配置。基线提交：`59700b836ebaf052001414aea6c6bcd5ff0c1709`。项目属于 Brownfield，延续现有 Superpowers specs/plans，不初始化其他规格体系。根无 `.codegraph/`，按项目指令跳过 CodeGraph。执行日期：2026-10-03（Asia/Shanghai）。

状态：实现、目标测试、最终安装态证据与独立审查已完成。审查结论 Spec PASS / Quality APPROVE，未发现可复现的 Critical / Important 缺陷；正式规格与计划状态已同步。

## 实现和配置契约

新增可选根配置 `contextMaxTokens`，范围为0到Number.MAX_SAFE_INTEGER的整数。三插件manifest、运行时配置解析/校验均接受它；未配置时保留原注入格式、预算和tokenizer行为。零分配不返回注入。运行时没有共享可变预算总账。

Profile示例保存如下：

```json
{"totalTokens":100,"allocations":{"knowledge":40,"memory":40,"bridge":20}}
```

执行 `node scripts/check-context-budget.mjs profile.json knowledge,memory,bridge`，启用列表必须包含所有需要纳入预算的插件。CLI只输出待人工合并片段，不写宿主配置：

```json
{"plugins":{"entries":{"knowledge":{"config":{"contextMaxTokens":40}},"memory":{"config":{"contextMaxTokens":40}},"bridge":{"config":{"contextMaxTokens":20}}}}}
```

| 插件 | 配置接收与消费 | 来源与去重 |
| --- | --- | --- |
| knowledge | manifest → createKnowledgeConfig/validateKnowledgeConfig → hook | 同sourceId仅保留首条；缺失才用chunk ID；预算分支跳过旧tokenizer，用显式template或紧凑Untrusted knowledge前缀 |
| memory | manifest/入口schema → resolveConfig → recall hook | 同citation首条保留；缺失citation用snippet作稳定回退；保留旧终止标点规则，标记Untrusted history |
| bridge | manifest/入口schema + validateBridgeConfig根白名单 → context hook | 标记实际channel，标签及平台预设都计入分配 |

计数器固定为 `utf8-byte-upper-bound-v1`。计量是UTF-8字节保守上界，**不是模型精确token计量**；覆盖byte-level tokenizer的文本token上界。标签编码控制字符并保留来源路径斜杠；完整标签和正文共同计数。预算不足以容纳完整标签与至少一个正文码点时不注入。截断保持完整Unicode码点，不保证保留完整字形簇或完整句子。

该预算只覆盖三个插件返回的注入字符串之和，不包括宿主系统prompt、历史、工具、宿主拼接分隔符等开销。

O1的promptBuilder、实际工具可用性、会话身份、跨会话隔离和持久化逻辑保持原语义。Memory预算分支保留历史句末标点规则，原E2E完整事实断言未削弱。

## 文件范围

计划内：SDK `src/text/context-budget.ts`及测试、text/index.ts；CLI及测试；Knowledge hook及直接/组合测试；Memory入口及直接测试；Bridge context hook及直接测试。

经主Agent逐项扩展：三插件package.json、pnpm-lock.yaml、三manifest；Memory config.ts；Knowledge types.ts、config/config.ts、retriever/hybrid.ts、embedding/{factory,openai,dashscope,zhipu,qianfan,ollama}.ts及取消测试、shared/provider-http.ts；Bridge plugin-entry.ts、message-bridge.ts（仅配置类型/白名单/数字校验）及完整入口测试；三份E2E config/adapter；install.mjs只更新经独立审查的knowledge/memory/bridge三条pin。本报告属于任务指定交付。

SDK依赖为既有workspace:^2026.7.1，不新增外部库。离线lock-only因本地缺openclaw元数据失败；临时手改锁已撤销。最终通过正式 `pnpm install --lockfile-only --ignore-scripts` 生成（23秒），diff仅三条workspace link。发布脚本沿用既有workspace→semver映射；E2E安装本轮SDK tarball。没有全局工具安装或发布。

## 取消链及实际边界

安装的OpenClaw 2026.9.6文档确认：hookInvocation只有assertActive，没有取消事件或AbortSignal。三插件进入hook及异步工作完成后检查活性；过期后不返回迟到注入。不能声称宿主超时会立即中止所有底层任务。

- Knowledge显式signal：hook → hybridSearch → factory wrapper → OpenAI/DashScope/Zhipu/Qianfan embedBatch → postEmbeddingJson → requestProviderJson → fetch组合signal。取消中止fetch，不继续重试；退避等待也响应取消。
- Ollama 0.6.3支持构造器fetch注入；显式signal分支使用每请求独立client/fetch闭包，组合调用方signal与timeout，避免共享client.abort误取消其他会话。五provider测试均在实际fetch调用边界捕获signal并验证abort、无重试。
- Knowledge store接收SearchOptions.signal和keywordSearch第四参数；现有SQLite/内存向量计算是同步操作，不具备执行途中中断能力。可选reranker/tokenizer接口无signal参数；await后检查活性，预算分支完全跳过tokenizer。宿主仅撤销assertActive时，已有网络任务可能完成，但结果不注入。
- Memory合并显式signal与本地召回timeout controller，进入现有manager.search和JSONL文件/流读取。分别验证主动取消与50ms本地超时后的迟到结果丢弃。
- Bridge同步hook在已过期invocation上不注入。来源去重是每个插件自身结果内的稳定来源去重，没有跨插件全局可变集合。

## RED → GREEN 与验证

1. CLI/SDK新测试先因目标模块缺失RED；随后profile 40/40/20通过、40/40/21拒绝、负数/非整数/缺分配拒绝；中文/emoji、零预算、完整标签、同源去重测试GREEN。
2. 真实Knowledge+Memory+Bridge hook组合fixture原总上界2033>100，过期检索仍注入，已过期组合不能全返回undefined（RED）。实现后40/40/20总100、取消后零注入（GREEN）。另以充足1000预算验证同sourceId异chunk去重，避免截断掩盖问题。
3. Memory安装态发现句末标点差异后，增加目标测试确认RED（1失败、其余51项按-t过滤）；修复后完整52项GREEN、0跳过。
4. Bridge完整入口测试复现rootUnknown拒绝新配置（1失败/13通过）；补运行时白名单及整数校验后完整158项GREEN、0跳过。

| 验证 | 结果 |
| --- | --- |
| node --test scripts/check-context-budget.test.mjs | 1通过，0跳过 |
| message-sdk全量vitest | 67文件、522通过，0跳过 |
| Knowledge全量vitest | 25文件、173通过，0跳过 |
| Memory全量vitest | 1文件、52通过，0跳过 |
| Bridge全量vitest | 9文件、158通过，0跳过 |
| 三插件typecheck/build；SDK build及pack出口/consumer/宿主契约 | 通过 |
| node --test scripts/e2e/lib/install.test.mjs | 3通过，0跳过 |
| 组合fixture最终重测 | 4通过，40/40/20总100，2.159041ms |
| git diff --check | 通过 |

组合延迟使用mock检索后端；下方安装态延迟使用本地固定fixture。都不是生产性能SLO或P50/P95。

## 安装态执行与失败修正

完整运行命令（ID分别为bridge,mqtt、knowledge、memory，顺序执行）：

```sh
OPENCLAW_E2E_HOST_GATEWAY=1 \
OPENCLAW_E2E_STATE_DIR=/tmp/openclaw-o2-e2e \
OPENCLAW_STATE_DIR=/tmp/openclaw-o2-e2e \
OPENCLAW_CONFIG_PATH=/tmp/openclaw-o2-e2e/openclaw.json \
node scripts/e2e/run-e2e.mjs --plugins ID
```

runner reset只清理显式一次性E2E目录，安装前seed配置、安装后重新生成该目录openclaw.json。Gateway继承相同环境。未使用skip-install/skip-browser。Knowledge、Memory按runner要求单独执行；Bridge需要MQTT配套。100预算三方组合由真实hook单测覆盖；安装态按隔离要求分别验证。

实际排错记录：

- 三插件一起运行被runner前置隔离规则拒绝，改为分别执行。
- 新候选首次被consent digest门禁拒绝。主Agent独立核对归档SHA、解包digest、安全tar条目、manifest/capabilities、dist及source map后逐项批准pin；后续Memory/Bridge生产源码修正都重新走候选审查。没有绕过门禁。
- Knowledge probe漏agentId导致:bot/:agent隔离键不匹配；只修夹具显式传main。
- 最初只设OPENCLAW_E2E_STATE_DIR，宿主CLI仍使用专用queue-e2e profile配置，Gateway显示Knowledge Disabled；修正为上述完整环境。先前触及的是专用queue-e2e测试profile安装记录，没有删除其既有数据，未改用户生产默认profile。
- Memory新预算路径漏补句末标点，真实完整事实断言失败；修复生产代码并保留原断言。
- 普通Node直接import安装包无法解析Gateway提供的openclaw peer；按Knowledge既有夹具方式，仅在一次性安装目录node_modules链接当前已验证宿主。仍导入tarball dist，未替换为源码；原归档digest在链接前已校验。
- Bridge运行时根字段白名单拒绝contextMaxTokens；完整入口测试后补齐校验。
- install.mjs属于共享指纹输入；最终pin稳定后所有相关场景重跑，旧PASS不替代最终报告。

三份.browser-*.log均保留原修改，不纳入本任务提交。全量27插件E2E不属于本次范围；最终证据校验限定Knowledge、Memory、Bridge及配套MQTT。未执行付费/实网模型、生产部署或发布；本轮均为OpenClaw稳定宿主与本地fixture。

## 最终安装态证据

### bridge + mqtt

- 报告：`scripts/e2e/reports/2026-10-02T17-22-19.803Z-bridge+mqtt-ffa310bd-f7d1-42e6-98df-50f7271bede9.json`
- 当前 validateEvidence：`[]`；PASS，0 skip。
- 候选清单：`/Users/wandl/workspaces/workspace-agent-fabric/openclaw-plugins/.worktrees/openclaw-stable-upgrade/scripts/e2e/reports/candidates/0fad9214-ed71-4719-8dff-df52d4b3bd4b.json`
- 宿主：2026.9.6，Node v24.18.0；CLI：`/Users/wandl/workspaces/workspace-agent-fabric/openclaw-plugins/.worktrees/openclaw-stable-upgrade/node_modules/.pnpm/openclaw@2026.9.6_@aws-sdk+credential-provider-node@3.972.43_@opentelemetry+api@1.9.1_@smithy+signature-v4@5.4.3/node_modules/openclaw/openclaw.mjs`
- bridge 当前 sourceFingerprint：`bff4735de03534d14b7288b52959b0ec3e51f85f433a61e0a6551d3a823de25c`
- bridge 安装归档 SHA-256：`28e0d973bb0eaa58b9e77af5d1002004daa5ef11f2e1a72a85058e3c497918dc`
- mqtt 当前 sourceFingerprint：`09a6ffc3d5d64a5ef5f0a5ecba9b1fa525af30d176c187264f62d1587671ca1e`
- mqtt 安装归档 SHA-256：`a207f18b4e0429d718a71073e4e0057959bce5b846b8dc8cc391bca5a519e850`

### knowledge

- 报告：`scripts/e2e/reports/2026-10-02T17-24-18.273Z-knowledge-881d98fb-cfce-4a36-a93c-b13e58c90aca.json`
- 当前 validateEvidence：`[]`；PASS，0 skip。
- 候选清单：`/Users/wandl/workspaces/workspace-agent-fabric/openclaw-plugins/.worktrees/openclaw-stable-upgrade/scripts/e2e/reports/candidates/c748e302-990e-414e-920e-f696eb567a9e.json`
- 宿主：2026.9.6，Node v24.18.0；CLI：`/Users/wandl/workspaces/workspace-agent-fabric/openclaw-plugins/.worktrees/openclaw-stable-upgrade/node_modules/.pnpm/openclaw@2026.9.6_@aws-sdk+credential-provider-node@3.972.43_@opentelemetry+api@1.9.1_@smithy+signature-v4@5.4.3/node_modules/openclaw/openclaw.mjs`
- knowledge 当前 sourceFingerprint：`4f958dbc1f89abcb55ed5b376aaa2a628f187d3683e54978362566d69f89ecb2`
- knowledge 安装归档 SHA-256：`666f290fa56f34827e79c9835255ff30d45c212fa495a06d508a327f6e4d9866`

### memory

- 报告：`scripts/e2e/reports/2026-10-02T17-25-47.628Z-memory-ad3080ac-591e-49f0-bbde-b29a850a40ad.json`
- 当前 validateEvidence：`[]`；PASS，0 skip。
- 候选清单：`/Users/wandl/workspaces/workspace-agent-fabric/openclaw-plugins/.worktrees/openclaw-stable-upgrade/scripts/e2e/reports/candidates/c3c64f2f-f130-4427-9844-04f06c4695f4.json`
- 宿主：2026.9.6，Node v24.18.0；CLI：`/Users/wandl/workspaces/workspace-agent-fabric/openclaw-plugins/.worktrees/openclaw-stable-upgrade/node_modules/.pnpm/openclaw@2026.9.6_@aws-sdk+credential-provider-node@3.972.43_@opentelemetry+api@1.9.1_@smithy+signature-v4@5.4.3/node_modules/openclaw/openclaw.mjs`
- memory 当前 sourceFingerprint：`e838293d3993a0dcb859aa677a8b77c272295b6169c44913e4b33a3088dfa266`
- memory 安装归档 SHA-256：`494ff3d8f2b9bbf670e39ebe83390cb754e6e5cfcd37d5f47ff285c3449ebf02`

## 计量、候选审查和收口边界

| 安装态 probe | UTF-8 token 保守上界 | 分配上限 | 单次耗时 |
| --- | ---: | ---: | ---: |
| Knowledge | 160 | 4096 | 7.856084 ms |
| Memory | 831 | 4096 | 7.321250 ms |
| Bridge | 345 | 1024 | 0.095958 ms |

三项均验证实际安装包返回的来源标记、分配上限和过期 invocation 零注入；MQTT 保留完整转发验证。耗时为本地 probe 单次观测，不作为稳定性能基准。

独立审查通过的最终候选及内容 digest：

- Knowledge：`/tmp/o2-final-candidates/knowledge/partme.ai-openclaw-knowledge-2026.7.1.tgz`；`84f8c0139c2e4f42af0da6b563423f0ad573b8bff6381721821b9638d1d16410`；38 份 source-map 源码匹配。
- Memory v2：`/tmp/o2-memory-v2/partme.ai-openclaw-memory-2026.7.1.tgz`；`8b694af79213368ed7f0fe24b337b04e7ec20ebb1a3d23d12c941643932c4871`；5 份 source-map 源码匹配。
- Bridge v2：`/tmp/o2-bridge-v2/partme.ai-openclaw-bridge-2026.7.1.tgz`；`f119e5bec01ad15dffef67f20d946693107c2cd69d70412fcad9ffe572c41cab`；3 份 map 合计 11 份源码匹配。

三份候选构建 HEAD 均为本报告基线，输入包括本任务未提交修改；最终输入 fingerprint 以上方各报告当前值为准。审查时的旧 review.json fingerprint 因 adapter/共享 install.mjs 修改已过期，不作为最终证据。归档 SHA 见上方，最终 runner 重包字节与审查归档一致。主 Agent 验证安全 tar 条目、package/manifest/dist、source maps 与工作树匹配，capabilities 无新增。MQTT 重包内容 digest 仍为 `0b30d417d6a6cf11994c5d0367aba92707d090c7ceb20398e4c98b02587f7d66`，原 pin 无需修改。

最终四项 scoped `validateEvidence` 均为 `[]`，主 Agent 也独立复核通过。全仓 `node scripts/check-e2e-evidence.mjs` 实际退出 1，报告其他 23 项证据不满足门禁：共享 SDK/harness 输入变化使旧指纹过期，部分旧报告还缺宿主/候选或 PASS 证据。因此本任务完成不等于全仓发布门禁通过；其余插件由主任务后续收口。

CLAUDE 的每任务 4k token 约束已超出，实施中已及时告知主 Agent；原因是跨三插件取消链、正式配置接收路径和安装态 consent/隔离门禁的必要扩展。未静默删减组合 fixture、实际安装态、provider 信号或原业务断言。

自审结论：预算仅在显式配置时启用；同源去重按稳定来源；异步阶段均防止迟到注入；可用 signal 传到实际网络 I/O；没有全局可变总账。剩余限制为宿主不提供取消事件、同步存储不可中断、计数为保守上界，以及全仓其他 23 项 E2E 证据待刷新。独立审查另运行 103 项目标测试，全部通过、0 跳过；复核四项最终报告的候选归档与当前输入指纹，均为 `validateEvidence=[]`。审查未重跑安装态，锁文件生成历史来自实施记录，当前差异仅三条 workspace link。CLAUDE 单任务 4k token 上限也在独立审查中超出并已报告。
