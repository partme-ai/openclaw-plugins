# OpenClaw Plugins — 贡献指南

## 新建插件

```bash
pnpm new-plugin <name> --label "显示名称" --desc "插件描述"
```

这会从 `extensions/_template` 生成完整骨架：

```
extensions/<name>/
├── index.ts              # 插件入口
├── openclaw.plugin.json  # OpenClaw 清单
├── package.json          # npm 元数据
├── tsconfig.json         # TypeScript 配置
├── tsup.config.ts        # 构建配置
├── vitest.config.ts      # 测试配置
└── src/
    ├── channel.ts        # ChannelPlugin 实现
    ├── config.ts         # Zod schema + JSON Schema
    ├── media.ts          # 媒体处理
    ├── monitor.ts        # 消息去重 + webhook
    ├── runtime.ts        # 运行时状态
    └── types.ts          # 类型定义
```

## 开发流程

```bash
cd extensions/<name>
pnpm install           # 安装依赖
pnpm dev               # 开发模式（tsup watch）
pnpm typecheck         # 类型检查
pnpm test              # 运行测试
pnpm build             # 生产构建
```

## 规范要求

所有插件必须遵守 [spec/PLUGIN_SPEC.md](../spec/PLUGIN_SPEC.md)：

| 要求 | 说明 |
|------|------|
| TypeScript strict | `tsconfig.json` 继承 `../../tsconfig.base.json` |
| Zod + JSON Schema | `src/config.ts` 导出 Zod schema 和 JSON Schema |
| 类型化错误 | 自定义 Error 子类，包含结构化字段 |
| 状态上报 | 通过 `setStatus` 报告生命周期事件 |
| Co-located 测试 | `src/foo.test.ts` 与 `src/foo.ts` 同目录 |
| 80%+ 覆盖率 | `vitest run --coverage` |

## 测试规范

```bash
pnpm test                    # 运行所有测试
npx vitest run src/media     # 运行单个模块
```

命名：`<module>.<feature>.test.ts`

```
src/media.test.ts
src/media.errors.test.ts
src/monitor.test.ts
src/monitor.webhook.test.ts
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
