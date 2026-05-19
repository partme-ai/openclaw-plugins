# @partme.ai/openclaw-meituan

OpenClaw 美团开放平台渠道与运营工具插件，公域 Agent-First 智能运营。符合《公域平台 Agent-First 智能运营设计文档》与《美团开放平台对接规格》。

**「美团 - AI 运营官」三端实现**：本仓库为 **OpenClaw（TypeScript）** 实现；同规格的 **OctoClaw（Rust）** 与 **OctoClaw-4j（Java）** 实现见：

| 运行时 | 项目路径 | 说明 |
|--------|----------|------|
| **OctoClaw（Rust）** | [octoclaw/crates/octoclaw-channel-meituan](../octoclaw/crates/octoclaw-channel-meituan) | ChannelKind::Meituan、webhook 验签与路由、5 个 Tool（含团购核销/店铺二维码） |
| **OctoClaw-4j（Java）** | [octoclaw-4j-plugin-meituan](../octoclaw-4j-plugin-meituan) | PF4J 插件，EP-1 Channel + EP-3 工具 + EP-7 心跳，JAR 放入 `plugins/` 加载 |

三端在配置语义、Webhook 验签、工具名与参数上保持一致，见《[美团开放平台对接规格](../partme-docs/6、OctoClaw/5、美团开放平台对接规格.md)》§8。

**插件契约**：本插件遵循「以 OctoClaw 为主、借鉴 ZeroClaw/OpenClaw」的优化约定（见《[借鉴 zeroclaw/openclaw 优化自定义插件实现](../partme-docs/6、OctoClaw/10、借鉴-zeroclaw-openclaw-优化自定义插件实现.md)》）：单次 `register(api)` 内完成 channel + httpRoute + tools；若运行时注入 `api.logger` 则用于日志，注入 `api.pluginConfig` 则与 `channels.meituan` 合并作为配置覆盖。

## 能力

- **渠道** `meituan`：配置 `channels.meituan`（app_key、app_secret、callback_url、shop_id 等）
- **Webhook**：`POST /channels/meituan/webhook` 接收美团开放平台事件
- **工具**（若运行时提供 `registerTool`）：meituan_query_orders、meituan_reply_review、meituan_query_shop_metrics、meituan_verify_writeoff、meituan_shop_qrcode

## 安装与配置

安装后于 `openclaw.json` 的 `channels.meituan` 中配置凭证与回调 URL。在美团开放平台将回调地址设为 `https://<域名>/channels/meituan/webhook`。

## 构建

```bash
pnpm install
pnpm build
```

## E2E 验证

在 OpenClaw 主工程中加载本插件并配置 `channels.meituan` 后，可使用《[美团插件 E2E 验证说明](../../partme-docs/6、OctoClaw/9、美团插件-E2E验证说明.md)》中的方法，通过模拟 Webhook（含 HMAC-SHA256 签名）验证入站与工具注册。
