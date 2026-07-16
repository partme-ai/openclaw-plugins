# @partme.ai/openclaw-meituan

OpenClaw 2026.7.1 的美团技术服务合作中心 MTOp OpenAPI capability。它不是聊天渠道，也不虚构订单、评价或核销接口；实际 API 路径和 `businessId` 必须来自你的美团应用后台与对应业务文档，并通过配置白名单开放给 Agent。

## 能力边界

- 按官方 `MtOpJavaSDK` 通用请求协议发送 `application/x-www-form-urlencoded` POST。
- 自动构造 `biz`、`businessId`、`developerId`、`timestamp`、`charset`、`version`、`appAuthToken` 和 SHA-1 `sign`。
- 只允许调用 `operations` 中显式配置的路径，不接受 Agent 自由输入 URL。
- 默认只允许消息 owner 调用，带本地每分钟限流、请求超时、请求/响应体上限。
- 不自动重试 POST，避免核销、退款等非幂等操作被重复执行。

## 安装

```bash
openclaw plugins install @partme.ai/openclaw-meituan
```

## 配置

```json
{
  "plugins": {
    "entries": {
      "meituan": {
        "enabled": true,
        "config": {
          "enabled": true,
          "developerId": "你的开发者ID",
          "signKey": "你的签名密钥",
          "appAuthToken": "门店授权令牌",
          "operations": [
            {
              "name": "receipt_query",
              "description": "按日期查询验券记录",
              "apiPath": "/从美团开发者中心复制的真实路径",
              "businessId": 真实业务ID,
              "requiresAuth": true
            }
          ]
        }
      }
    }
  }
}
```

凭据也可通过 `MEITUAN_DEVELOPER_ID`、`MEITUAN_SIGN_KEY`、`MEITUAN_APP_AUTH_TOKEN` 注入。配置中的值优先。

默认网关是 `https://api-open-cater.meituan.com`，网关版本为 `2`。除本机回环测试外，`apiBaseUrl` 必须使用 HTTPS。

## Agent 工具

插件注册一个工具 `meituan_openapi_invoke`：

```json
{
  "operation": "receipt_query",
  "biz": {
    "date": "2026-07-16",
    "offset": 0
  }
}
```

`biz` 的字段必须以该 API 的官方文档为准。工具返回美团原始 JSON 响应，但不会返回 `signKey` 或 `appAuthToken`。

## 上线前验证

1. 在美团合作中心确认应用已开通目标业务和接口权限。
2. 从后台/官方文档复制每个 API 的路径、`businessId` 和业务参数，不要猜测。
3. 完成门店授权并配置有效 `appAuthToken`；需要鉴权的接口缺少令牌会直接拒绝。
4. 先用只读接口验证 `OP_SUCCESS`、traceId、限流和超时，再开放核销/退款等写操作。
5. 多 Gateway 部署时在上游网关增加集中限流；插件内限流仅约束单进程。

公开的美团生态开放平台入口：<https://openapi.meituan.com/>。
