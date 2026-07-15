# OpenClaw Plugins — 贡献指南

## 新建插件

```bash
pnpm new-plugin PLUGIN_NAME --label "显示名称" --desc "插件描述"
```

这会从 `extensions/_template` 生成完整骨架：

```
extensions/<name>/
├── openclaw.plugin.json  # OpenClaw 清单
├── package.json          # npm 元数据
├── tsconfig.json         # TypeScript 配置
├── tsup.config.ts        # 构建配置
├── vitest.config.ts      # 测试配置
├── src/
│   ├── index.ts          # 运行时入口：defineChannelPluginEntry
│   ├── setup-entry.ts    # Setup 冷路径入口
│   ├── channel.ts        # ChannelPlugin 实现
│   ├── channel-setup-factory.ts # Setup Adapter 与 Wizard
│   ├── onboarding.ts     # Setup 流程导出
│   ├── inbound.ts        # 入站消息处理
│   ├── outbound.ts       # 出站消息适配
│   ├── config.ts         # 配置解析与校验
│   ├── runtime.ts        # 运行时状态
│   ├── types.ts          # 类型定义
│   └── transport/
│       └── server.ts     # Webhook、HTTP 或 Broker I/O
└── test/
    └── *.test.ts         # 插件单元测试
```

## 开发流程

```bash
pnpm install                                      # 在仓库根目录安装依赖
pnpm --filter './extensions/<name>' dev           # 开发模式（tsup watch）
pnpm --filter './extensions/<name>' typecheck     # 类型检查
pnpm --filter './extensions/<name>' test          # 运行测试
pnpm --filter './extensions/<name>' build         # 生产构建
```

## 规范要求

所有插件必须遵守 [spec/PLUGIN_SPEC.md](../spec/PLUGIN_SPEC.md)：

| 要求 | 说明 |
|------|------|
| TypeScript strict | `tsconfig.json` 继承 `../../tsconfig.base.json` |
| Zod + JSON Schema | `src/config.ts` 导出 Zod schema 和 JSON Schema |
| 类型化错误 | 自定义 Error 子类，包含结构化字段 |
| 状态上报 | 通过 `setStatus` 报告生命周期事件 |
| 测试目录 | 新插件单元测试统一放在 `test/*.test.ts`；迁移期允许保留已有 `src/**/*.test.ts` |
| 80%+ 覆盖率 | `vitest run --coverage` |

## 测试规范

```bash
pnpm --filter './extensions/<name>' test
pnpm --filter './extensions/<name>' exec vitest run test/media.test.ts
```

新插件测试放在 `test/`，命名为 `<module>.<feature>.test.ts`：

```
test/media.test.ts
test/media.errors.test.ts
test/monitor.test.ts
test/monitor.webhook.test.ts
```

## 发布

### 预览

```bash
node scripts/publish-changed.mjs --dry-run
```

### 发布单个

```bash
node scripts/publish-changed.mjs --plugin wecom
```

### 预发布

```bash
node scripts/publish-changed.mjs --plugin wecom --tag next
```

发布脚本自动对比本地版本与 npm registry，只发布版本号有变化的插件。

## 提交 PR

1. Fork 仓库
2. 创建分支：`git checkout -b feat/my-feature`
3. 开发 + 测试
4. 确保 `pnpm typecheck` 和 `pnpm test` 通过
5. 提交 PR 到 `main` 分支

CI 会自动检测变更的插件，按矩阵并行构建和测试。
