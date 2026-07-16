# OpenClaw Knowledge 集成说明（2026.7.1）

## 推荐方式：独立插件

通过 OpenClaw 插件安装命令安装后，在 `plugins.entries.knowledge` 启用。独立插件会自行注册 hook、四个工具和 Gateway 停止清理，不需要修改 WeCom、Nacos、Router 或其他 channel 插件。

## 库式 API

包同时导出以下集成接口：

- `registerKnowledgeHooks`
- `createKnowledgeAddTool` / `createKnowledgeQueryTool` / `createKnowledgeUpdateTool` / `createKnowledgeDeleteTool`
- `indexFile` / `indexFiles` / `searchByQuery`
- `getOrCreateStore` / `invalidateStoreCache`

工具工厂签名为 `(ctx, resolvedConfig)`，不能从 tool context 读取不存在的 `pluginConfig`。嵌入其他插件时，调用方必须先创建并校验最终配置，再用闭包传入。

## 文件摄取责任边界

OpenClaw tool 调用路径已执行 owner、realpath、根目录和大小检查。直接调用库式 `indexFile` 时，调用方负责在进入 API 前完成同等级别授权与路径约束；该低层 API 不替代业务 ACL。

## 运行期变更

配置指纹变化会重建对应 namespace 的 embedding/store 组合。部署或测试结束时调用 `invalidateStoreCache()`；独立插件已在 `gateway_stop` 自动处理。
