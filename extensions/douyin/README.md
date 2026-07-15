# Douyin Life Service plugin

`@partme.ai/openclaw-douyin` integrates OpenClaw with Douyin Life Service merchant applications.

It provides signed Webhook ingestion, cached `client_token` authentication, the official order-query API, and the catering review-reply API. Webhook `content` may be either an object or a JSON string; events are acknowledged within Douyin's callback window and dispatched asynchronously through the OpenClaw transcript pipeline.

The Life Service Webhook is not a symmetric direct-message protocol. Generic channel `sendText` therefore fails explicitly instead of returning a fake delivery result.

## Configuration

```jsonc
{
  "channels": {
    "douyin": {
      "enabled": true,
      "app_key": "your_client_key",
      "app_secret": "your_client_secret",
      "account_id": "your_life_account_id",
      "poi_id": "your_poi_id",
      "webhook_path": "/channels/douyin/webhook",
      "callback_url": "https://example.com/channels/douyin/webhook",
      "request_timeout_ms": 10000
    }
  }
}
```

`shop_id` remains a compatibility alias for `account_id`; new configurations should use `account_id` and `poi_id` explicitly. `accounts.<id>` may override all account-specific settings.

## Tools

- `douyin_query_orders` calls `GET /goodlife/v1/trade/order/query/` and requires `life.capacity.order.query`.
- `douyin_reply_review` calls `POST /goodlife/v1/akte/comment/reply/` and requires `life.capacity.catering.comment` plus review-reply permission.

OpenAPI credentials are sent using the official `access-token` header. Platform errors are surfaced to the tool caller rather than converted into empty successful results.

## Verification

```bash
pnpm --dir extensions/douyin typecheck
pnpm --dir extensions/douyin test
pnpm --dir extensions/douyin build
```

Local tests use protocol-level mocks. Production acceptance still requires a permissioned Douyin Life Service application.

Official references: [WebHooks](https://partner.open-douyin.com/docs/resource/zh-CN/local-life/develop/preparation/webhooks), [client_token](https://partner.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/client-token), [order query](https://partner.open-douyin.com/docs/resource/zh-CN/local-life/develop/OpenAPI/general-capabilities/order.query/query), [review reply](https://developer.open-douyin.com/docs/resource/zh-CN/local-life/develop/OpenAPI/catering/dining-group-solution/food-review/reply_comment).
