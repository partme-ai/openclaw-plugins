# 微信客服 API 参考（转人工相关）

本 skill 仅涉及以下两个接口，完整说明以企微官方文档为准。

## 获取接待人员列表（94645）

- 文档：<https://developer.work.weixin.qq.com/document/path/94645>
- 用途：获取该智能客服所委托的客服账号的接待人员列表，用于转人工时选择坐席。
- 请求：GET `kf/servicer/list?access_token=xxx&open_kfid=xxx`
- 响应：`servicer_list[]`，每项含 `userid`、`status` 等。
- **status 约定**：`0` = 接待中，`1` = 停止接待。

## 分配客服会话（94669）

- 文档：<https://developer.work.weixin.qq.com/document/path/94669>
- 用途：变更会话状态，实现「转人工」或「排队」。
- 请求：POST `kf/service_state/trans`，Body 示例：
  - 转人工（指定坐席）：`{ "open_kfid", "external_userid", "service_state": 3, "servicer_userid": "<userid>" }`
  - 排队：`{ "open_kfid", "external_userid", "service_state": 2 }`
- **service_state**：`0` 未处理，`1` 由智能助手接待，`2` 待接入池，`3` 由人工客服接待，`4` 已结束。
- 当 `service_state = 3` 时，**必须**传 `servicer_userid`，且该 userid 须来自同一客服账号的接待人员列表。
