# openclaw_rednode

OpenClaw 小红书开放平台渠道与运营工具，公域 Agent-First 智能运营。（品牌名 rednode，渠道 id 保持 xhs。）

- **渠道 ID**：`xhs`
- **配置**：`channels.xhs`（app_id、app_secret、callback_url、shop_id/seller_id）
- **Webhook**：`POST /channels/xhs/webhook`，验签后 EP-1 入站映射
- **工具**：xhs_query_orders、xhs_query_order_detail、xhs_query_refunds、xhs_query_items、xhs_item_on_off_shelf

规格见 `partme-docs/6、OctoClaw/8、小红书开放平台对接规格.md`，API 以 [xiaohongshu.apifox.cn](https://xiaohongshu.apifox.cn/) 为准。

## 三端实现（小红书 - AI 运营官）

| 端 | 项目路径 | 说明 |
|----|----------|------|
| **OpenClaw** | 本仓库 `openclaw_rednode/` | 本插件 |
| **OctoClaw Rust** | `octoclaw/extensions/rednode/` | Webhook 入站 + EP-3 工具，需由引擎挂载 `xhs_webhook_router` |
| **OctoClaw-4j** | `octoclaw-4j-plugin-rednode/` | EP-1 Channel + EP-3 工具 + EP-7 心跳，JAR 放入引擎 `plugins/` |

## 构建

```bash
pnpm install
pnpm build
```
