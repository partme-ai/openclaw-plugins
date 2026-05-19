# @partme.ai/openclaw-meituan

OpenClaw 美团开放平台渠道与运营工具插件，公域 Agent-First 智能运营。符合《公域平台 Agent-First 智能运营设计文档》与《美团开放平台对接规格》。
| 运行时 | 项目路径 | 说明 |
|--------|----------|------|

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
