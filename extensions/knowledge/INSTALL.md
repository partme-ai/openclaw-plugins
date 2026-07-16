# Knowledge 安装与验收

## 安装

```bash
openclaw plugins install @partme.ai/openclaw-knowledge@2026.7.1
openclaw plugins inspect knowledge
openclaw doctor
```

配置放在 `plugins.entries.knowledge.config`。完整示例、权限边界和升级说明见 [README.md](README.md)。

## 最小验收

1. 配置真实 embedding provider，并确认返回维度与 `embedding.dimensions` 一致。
2. 启动 Gateway，确认没有 manifest、hook 或 tool 注册告警。
3. 在普通账号写入并查询当前 namespace。
4. 尝试指定另一个账号 namespace，确认被拒绝。
5. 使用 owner 验证全局 namespace；关闭 `allowOwnerGlobalNamespaces` 后再次确认被拒绝。
6. 文件摄取保持默认关闭；启用后验证允许目录、越界路径、符号链接和大小上限。
7. 重启 Gateway，确认 SQLite 数据仍可检索；若使用持久化 ZVec，同样验证退出刷新和恢复。

## 回滚

停用 `plugins.entries.knowledge.enabled` 后重启 Gateway。数据文件不会自动删除。embedding 模型或 dimensions 回滚时，应配套恢复对应索引，不要让不同维度复用同一 namespace。

详细文档位于 [`../../doc/knowledge`](../../doc/knowledge)。
