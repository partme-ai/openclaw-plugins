# @partme.ai/openclaw-rednode

OpenClaw 2026.7.1 的小红书 Ark Open API capability。它不是小红书私信/内容发布渠道，也不使用浏览器自动化；只调用商家 Ark 开放平台中显式配置的 API 白名单。

## 真实协议

- 生产网关：`https://ark.xiaohongshu.com`
- 官方沙箱：`http://flssandbox.xiaohongshu.com`
- `timestamp`、`app-key`、`sign` 放在 Header，Body 使用 JSON。
- 签名：API 路径 + 按名称排序的 query/Header 参数 + app-secret，再计算 MD5。
- 支持官方文档使用的 GET、POST、PUT；写操作必须传 `confirm: true`。

## 配置

```json
{
  "plugins": { "entries": { "rednode": {
    "enabled": true,
    "config": {
      "enabled": true,
      "appKey": "你的 app-key",
      "appSecret": "你的 app-secret",
      "environment": "production",
      "operations": [
        { "name": "item_list", "method": "GET", "apiPath": "/ark/open_api/v1/items" },
        { "name": "item_availability", "method": "PUT", "apiPath": "/ark/open_api/v1/item/{item_id}/availability" }
      ]
    }
  } } }
}
```

也可通过 `XHS_APP_KEY`、`XHS_APP_SECRET` 注入凭据。插件默认关闭、默认 owner-only，不接受 Agent 自由输入 URL。

插件只注册 `rednode_ark_invoke`。查询参数放 `query`，路径占位参数放 `path_params`，JSON 请求体放 `body`。本地限流仅针对单进程，多 Gateway 需在上游集中限流。

上线前必须先申请小红书沙箱，只从官方 Ark 文档复制 API 路径、方法和参数；先验证只读接口，再开放发货、上下架等写操作。

官方文档：[快速开始](https://school.xiaohongshu.com/en/open/quick-start/summary.html)、[签名示例](https://school.xiaohongshu.com/en/open/quick-start/sign.html)、[商品列表](https://school.xiaohongshu.com/en/open/product/item-list.html)。
