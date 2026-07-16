# OpenClaw AMap

适配 OpenClaw 2026.7.1 的高德 Web 服务 API 工具插件。它不是聊天渠道，不注册 Webhook，也不伪造消息发送能力。

## 工具

- `amap_search_places`：地点搜索 2.0，调用 `/v5/place/text`。
- `amap_search_nearby`：周边搜索 2.0，调用 `/v5/place/around`。
- `amap_place_detail`：地点详情 2.0，调用 `/v5/place/detail`。

## 配置

```json
{
  "plugins": {
    "entries": {
      "amap": {
        "enabled": true,
        "config": {
          "enabled": true,
          "requestTimeoutMs": 8000,
          "retryAttempts": 1,
          "maxResponseBytes": 1048576,
          "maxRequestsPerMinute": 120,
          "ownerOnly": false
        }
      }
    }
  }
}
```

生产环境通过 `AMAP_WEB_SERVICE_KEY` 注入 Web 服务 Key；也可使用敏感配置项 `key`。`apiBaseUrl` 默认固定为 `https://restapi.amap.com`，仅允许 HTTPS，回环测试地址可使用 HTTP。

插件校验工具参数、经纬度范围、超时、响应大小和高德业务状态码；429/5xx 与网络错误只做有限重试。进程内请求速率上限用于保护 Key 配额，但不能替代多实例统一限流。

官方接口依据：[Web 服务入门](https://lbs.amap.com/api/webservice/gettingstarted)、[地点搜索 2.0](https://lbs.amap.com/api/webservice/guide/api-advanced/newpoisearch)。
