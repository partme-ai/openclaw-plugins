# OpenClaw 高德 - AI 运营官插件

高德开放平台渠道与运营工具，公域 Agent-First 智能运营。符合《公域平台 Agent-First 智能运营设计文档》与《高德开放平台对接规格》。

- **渠道 ID**：`amap`
- **配置节点**：`channels.amap`（key 必填；secret、callback_url、poi_id 可选）
- **Webhook 路径**：`POST /channels/amap/webhook`（当前高德无统一事件推送，可选入站）
- **工具**：`amap_query_poi`、`amap_query_around`、`amap_place_detail`

**三端实现**：本仓库为 **OpenClaw（TypeScript）** 实现；同规格的 **OctoClaw（Rust）** 与 **OctoClaw-4j（Java）** 实现见：

| 端 | 位置 | 说明 |
|----|------|------|
| **OctoClaw（Rust）** | octoclaw/crates/octoclaw-channel-amap | ChannelKind::Amap、3 个 Tool（POI/周边/详情） |
| **OctoClaw-4j（Java）** | octoclaw-4j-plugin-amap | PF4J 插件，EP-1 Channel + EP-3 工具 |

三端在配置语义、工具名与参数上保持一致，见《高德开放平台对接规格》与《高德开放平台接口对照表清单》。
