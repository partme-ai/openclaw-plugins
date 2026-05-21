# RedNote (Xiaohongshu)

OpenClaw 小红书开放平台渠道与运营工具，公域 Agent-First 智能运营。（品牌名 rednode，渠道 id 保持 xhs。）

- **渠道 ID**：`xhs`
- **配置**：`channels.xhs`（app_id、app_secret、callback_url、shop_id/seller_id）
- **Webhook**：`POST /channels/xhs/webhook`，验签后 EP-1 入站映射
- **工具**：xhs_query_orders、xhs_query_order_detail、xhs_query_refunds、xhs_query_items、xhs_item_on_off_shelf

| 端 | 项目路径 | 说明 |
|----|----------|------|
| **OpenClaw** | 本仓库 `openclaw_rednode/` | 本插件 |

## 构建

```bash
pnpm install
pnpm build
```
