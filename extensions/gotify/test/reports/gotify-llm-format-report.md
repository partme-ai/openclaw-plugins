# Gotify LLM Format Report

Generated at: 2026-05-22T17:52:03.412Z

## Q01 普通文本测试

- status: pass
- sessionKey: `agent:main:gotify:e2e:direct:1`
- inputType: `text`

### expected sdk_inbound
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【{CORRELATION_ID}】请只回复：收到",
  "media": [],
  "direction": "inbound",
  "metadata": {
    "caseId": "Q01",
    "promptKind": "plain_text"
  }
}
```

### expected sdk_expected_reply
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text_rule": "non_empty",
  "media": [],
  "direction": "outbound"
}
```

### expected channel_expected_payload
```json
{
  "title": "gotify-q01-plain-text",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  }
}
```

### actual turn 1

#### actual inbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7ubrd-ab5jhc",
  "traceId": "mph7ubrd-00w47x5y",
  "timestamp": 1779472265737,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【v36t3pxh】请只回复：收到",
  "media": [],
  "metadata": {
    "id": 37,
    "appid": 1,
    "title": "gotify-q01-plain-text",
    "priority": 5,
    "date": "2026-05-22T17:51:03.071392418Z"
  },
  "direction": "inbound"
}
```

#### actual outbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7ubrd-yuug6x",
  "traceId": "mph7ubrd-ivcq4afg",
  "timestamp": 1779472265737,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "收到",
  "media": [],
  "metadata": {
    "gotifyId": 38,
    "gotifyAppId": 2,
    "title": "gotify-q01-plain-text",
    "priority": 5,
    "extras": {
      "openclaw": {
        "outbound": true,
        "source": "openclaw"
      }
    },
    "date": "2026-05-22T17:51:05.671183627Z"
  },
  "direction": "outbound"
}
```

#### actual Gotify user raw
```json
{
  "id": 37,
  "appid": 1,
  "message": "【v36t3pxh】请只回复：收到",
  "title": "gotify-q01-plain-text",
  "priority": 5,
  "date": "2026-05-22T17:51:03.071392418Z"
}
```

#### actual Gotify reply raw
```json
{
  "id": 38,
  "appid": 2,
  "message": "收到",
  "title": "gotify-q01-plain-text",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  },
  "date": "2026-05-22T17:51:05.671183627Z"
}
```

#### transcript user text

【v36t3pxh】请只回复：收到

#### transcript assistant text

收到

## Q02 普通文本总结测试

- status: pass
- sessionKey: `agent:main:gotify:e2e:direct:1`
- inputType: `text`

### expected sdk_inbound
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【{CORRELATION_ID}】请把这句话总结成 8 个字以内：OpenClaw 通过 Gotify 收发智能体消息。",
  "media": [],
  "direction": "inbound",
  "metadata": {
    "caseId": "Q02",
    "promptKind": "summary"
  }
}
```

### expected sdk_expected_reply
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text_rule": "non_empty",
  "media": [],
  "direction": "outbound"
}
```

### expected channel_expected_payload
```json
{
  "title": "gotify-q02-summary",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  }
}
```

### actual turn 1

#### actual inbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7uj9a-pmubt5",
  "traceId": "mph7uj9a-2k26bmla",
  "timestamp": 1779472275454,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【dyue8ig2】请把这句话总结成 8 个字以内：OpenClaw 通过 Gotify 收发智能体消息。",
  "media": [],
  "metadata": {
    "id": 39,
    "appid": 1,
    "title": "gotify-q02-summary",
    "priority": 5,
    "date": "2026-05-22T17:51:07.381520211Z"
  },
  "direction": "inbound"
}
```

#### actual outbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7uj9a-iqwbjk",
  "traceId": "mph7uj9a-88ung9s2",
  "timestamp": 1779472275454,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "Gotify互通",
  "media": [],
  "metadata": {
    "gotifyId": 40,
    "gotifyAppId": 2,
    "title": "gotify-q02-summary",
    "priority": 5,
    "extras": {
      "openclaw": {
        "outbound": true,
        "source": "openclaw"
      }
    },
    "date": "2026-05-22T17:51:15.343350965Z"
  },
  "direction": "outbound"
}
```

#### actual Gotify user raw
```json
{
  "id": 39,
  "appid": 1,
  "message": "【dyue8ig2】请把这句话总结成 8 个字以内：OpenClaw 通过 Gotify 收发智能体消息。",
  "title": "gotify-q02-summary",
  "priority": 5,
  "date": "2026-05-22T17:51:07.381520211Z"
}
```

#### actual Gotify reply raw
```json
{
  "id": 40,
  "appid": 2,
  "message": "Gotify互通",
  "title": "gotify-q02-summary",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  },
  "date": "2026-05-22T17:51:15.343350965Z"
}
```

#### transcript user text

【dyue8ig2】请把这句话总结成 8 个字以内：OpenClaw 通过 Gotify 收发智能体消息。

#### transcript assistant text

Gotify互通

## Q03 Markdown 文本测试

- status: pass
- sessionKey: `agent:main:gotify:e2e:direct:1`
- inputType: `text`

### expected sdk_inbound
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "markdown",
  "text": "【{CORRELATION_ID}】请用 Markdown 回复，包含一个二级标题“测试结果”和两个无序列表项。",
  "markdown": "## 测试结果\n- 列表项一\n- 列表项二",
  "media": [],
  "direction": "inbound",
  "metadata": {
    "caseId": "Q03",
    "promptKind": "markdown"
  }
}
```

### expected sdk_expected_reply
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "markdown",
  "text_rule": "non_empty",
  "media": [],
  "direction": "outbound"
}
```

### expected channel_expected_payload
```json
{
  "title": "gotify-q03-markdown",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  }
}
```

### actual turn 1

#### actual inbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7umq1-sg4nqv",
  "traceId": "mph7umq1-1mgtrtoj",
  "timestamp": 1779472279945,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【axwa5qfi】请用 Markdown 回复，包含一个二级标题“测试结果”和两个无序列表项。",
  "media": [],
  "metadata": {
    "id": 41,
    "appid": 1,
    "title": "gotify-q03-markdown",
    "priority": 5,
    "date": "2026-05-22T17:51:17.200997424Z"
  },
  "direction": "inbound"
}
```

#### actual outbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7umq1-mync7n",
  "traceId": "mph7umq1-hlufvkw2",
  "timestamp": 1779472279945,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "markdown",
  "text": "## 测试结果\n\n- 消息 ID axwa5qfi 确认收到\n- 多轮交互功能正常",
  "markdown": "## 测试结果\n\n- 消息 ID axwa5qfi 确认收到\n- 多轮交互功能正常",
  "media": [],
  "metadata": {
    "gotifyId": 42,
    "gotifyAppId": 2,
    "title": "gotify-q03-markdown",
    "priority": 5,
    "extras": {
      "openclaw": {
        "outbound": true,
        "source": "openclaw"
      }
    },
    "date": "2026-05-22T17:51:19.704860759Z"
  },
  "direction": "outbound"
}
```

#### actual Gotify user raw
```json
{
  "id": 41,
  "appid": 1,
  "message": "【axwa5qfi】请用 Markdown 回复，包含一个二级标题“测试结果”和两个无序列表项。",
  "title": "gotify-q03-markdown",
  "priority": 5,
  "date": "2026-05-22T17:51:17.200997424Z"
}
```

#### actual Gotify reply raw
```json
{
  "id": 42,
  "appid": 2,
  "message": "## 测试结果\n\n- 消息 ID axwa5qfi 确认收到\n- 多轮交互功能正常",
  "title": "gotify-q03-markdown",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  },
  "date": "2026-05-22T17:51:19.704860759Z"
}
```

#### transcript user text

【axwa5qfi】请用 Markdown 回复，包含一个二级标题“测试结果”和两个无序列表项。

#### transcript assistant text

## 测试结果

- 消息 ID axwa5qfi 确认收到
- 多轮交互功能正常

## Q04 HTML 内容测试

- status: pass
- sessionKey: `agent:main:gotify:e2e:direct:1`
- inputType: `text`

### expected sdk_inbound
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【{CORRELATION_ID}】下面是一段 HTML，请忽略标签，只提取正文并用一句话回复：<article><h1>发布通知</h1><p>明天下午三点发布新版本。</p></article>",
  "media": [],
  "direction": "inbound",
  "metadata": {
    "caseId": "Q04",
    "promptKind": "html_content"
  }
}
```

### expected sdk_expected_reply
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text_rule": "non_empty",
  "media": [],
  "direction": "outbound"
}
```

### expected channel_expected_payload
```json
{
  "title": "gotify-q04-html",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  }
}
```

### actual turn 1

#### actual inbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7uqvw-jielbx",
  "traceId": "mph7uqvw-k3i8d0a3",
  "timestamp": 1779472285340,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【xuea01yb】下面是一段 HTML，请忽略标签，只提取正文并用一句话回复：\n<article><h1>发布通知</h1><p>明天下午三点发布新版本。</p></article>\n",
  "media": [],
  "metadata": {
    "id": 43,
    "appid": 1,
    "title": "gotify-q04-html",
    "priority": 5,
    "date": "2026-05-22T17:51:21.748749177Z"
  },
  "direction": "inbound"
}
```

#### actual outbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7uqvw-tb4eo2",
  "traceId": "mph7uqvw-76f4tqhx",
  "timestamp": 1779472285340,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "明天下午三点发布新版本。",
  "media": [],
  "metadata": {
    "gotifyId": 44,
    "gotifyAppId": 2,
    "title": "gotify-q04-html",
    "priority": 5,
    "extras": {
      "openclaw": {
        "outbound": true,
        "source": "openclaw"
      }
    },
    "date": "2026-05-22T17:51:25.16067297Z"
  },
  "direction": "outbound"
}
```

#### actual Gotify user raw
```json
{
  "id": 43,
  "appid": 1,
  "message": "【xuea01yb】下面是一段 HTML，请忽略标签，只提取正文并用一句话回复：\n<article><h1>发布通知</h1><p>明天下午三点发布新版本。</p></article>\n",
  "title": "gotify-q04-html",
  "priority": 5,
  "date": "2026-05-22T17:51:21.748749177Z"
}
```

#### actual Gotify reply raw
```json
{
  "id": 44,
  "appid": 2,
  "message": "明天下午三点发布新版本。",
  "title": "gotify-q04-html",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  },
  "date": "2026-05-22T17:51:25.16067297Z"
}
```

#### transcript user text

【xuea01yb】下面是一段 HTML，请忽略标签，只提取正文并用一句话回复：
<article><h1>发布通知</h1><p>明天下午三点发布新版本。</p></article>

#### transcript assistant text

明天下午三点发布新版本。

## Q05 带文件地址测试

- status: pass
- sessionKey: `agent:main:gotify:e2e:direct:1`
- inputType: `text`

### expected sdk_inbound
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【{CORRELATION_ID}】这里有一个文件地址：https://example.com/reports/weekly-sales.pdf 。请不要访问它，只根据地址判断文件类型，并给出 2 条处理建议。",
  "media": [],
  "direction": "inbound",
  "metadata": {
    "caseId": "Q05",
    "promptKind": "file_url",
    "fileUrl": "https://example.com/reports/weekly-sales.pdf"
  }
}
```

### expected sdk_expected_reply
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text_rule": "non_empty",
  "media": [],
  "direction": "outbound"
}
```

### expected channel_expected_payload
```json
{
  "title": "gotify-q05-file-url",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  }
}
```

### actual turn 1

#### actual inbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7uvdu-22gjmw",
  "traceId": "mph7uvdu-7f5gp7h4",
  "timestamp": 1779472291170,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【rwlpvwfk】这里有一个文件地址：https://example.com/reports/weekly-sales.pdf 。请不要访问它，只根据地址判断文件类型，并给出 2 条处理建议。",
  "media": [],
  "metadata": {
    "id": 45,
    "appid": 1,
    "title": "gotify-q05-file-url",
    "priority": 5,
    "date": "2026-05-22T17:51:27.183478846Z"
  },
  "direction": "inbound"
}
```

#### actual outbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7uvdu-skix7o",
  "traceId": "mph7uvdu-jhg7mdjl",
  "timestamp": 1779472291170,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "根据 URL 后缀 `.pdf` 判断，这是一个 PDF 文件。处理建议：\n\n1. **本地下载查看** — 使用浏览器或 PDF 阅读器打开，适合快速翻阅\n2. **解析提取内容** — 通过 AI 或工具提取文字/表格数据，方便后续分析或归档",
  "media": [],
  "metadata": {
    "gotifyId": 46,
    "gotifyAppId": 2,
    "title": "gotify-q05-file-url",
    "priority": 5,
    "extras": {
      "openclaw": {
        "outbound": true,
        "source": "openclaw"
      }
    },
    "date": "2026-05-22T17:51:31.071499833Z"
  },
  "direction": "outbound"
}
```

#### actual Gotify user raw
```json
{
  "id": 45,
  "appid": 1,
  "message": "【rwlpvwfk】这里有一个文件地址：https://example.com/reports/weekly-sales.pdf 。请不要访问它，只根据地址判断文件类型，并给出 2 条处理建议。",
  "title": "gotify-q05-file-url",
  "priority": 5,
  "date": "2026-05-22T17:51:27.183478846Z"
}
```

#### actual Gotify reply raw
```json
{
  "id": 46,
  "appid": 2,
  "message": "根据 URL 后缀 `.pdf` 判断，这是一个 PDF 文件。处理建议：\n\n1. **本地下载查看** — 使用浏览器或 PDF 阅读器打开，适合快速翻阅\n2. **解析提取内容** — 通过 AI 或工具提取文字/表格数据，方便后续分析或归档",
  "title": "gotify-q05-file-url",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  },
  "date": "2026-05-22T17:51:31.071499833Z"
}
```

#### transcript user text

【rwlpvwfk】这里有一个文件地址：https://example.com/reports/weekly-sales.pdf 。请不要访问它，只根据地址判断文件类型，并给出 2 条处理建议。

#### transcript assistant text

根据 URL 后缀 `.pdf` 判断，这是一个 PDF 文件。处理建议：

1. **本地下载查看** — 使用浏览器或 PDF 阅读器打开，适合快速翻阅
2. **解析提取内容** — 通过 AI 或工具提取文字/表格数据，方便后续分析或归档

## Q06 带任务的提示词测试

- status: pass
- sessionKey: `agent:main:gotify:e2e:direct:1`
- inputType: `text`

### expected sdk_inbound
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【{CORRELATION_ID}】你现在是内容运营助手。任务：根据下面的 brief 生成 3 条微信公众号标题。brief：产品是“企业消息联动平台”，核心卖点是“多渠道统一接入、消息可追踪、智能体自动回复”。",
  "media": [],
  "direction": "inbound",
  "metadata": {
    "caseId": "Q06",
    "promptKind": "task_generation"
  }
}
```

### expected sdk_expected_reply
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text_rule": "non_empty",
  "media": [],
  "direction": "outbound"
}
```

### expected channel_expected_payload
```json
{
  "title": "gotify-q06-task",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  }
}
```

### actual turn 1

#### actual inbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7v0c3-otmfqs",
  "traceId": "mph7v0c3-p2gq3kfb",
  "timestamp": 1779472297587,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【pow24qsr】你现在是内容运营助手。\n任务：根据下面的 brief 生成 3 条微信公众号标题。\nbrief：产品是“企业消息联动平台”，核心卖点是“多渠道统一接入、消息可追踪、智能体自动回复”。\n",
  "media": [],
  "metadata": {
    "id": 47,
    "appid": 1,
    "title": "gotify-q06-task",
    "priority": 5,
    "date": "2026-05-22T17:51:32.986145001Z"
  },
  "direction": "inbound"
}
```

#### actual outbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7v0c3-uh1oye",
  "traceId": "mph7v0c3-4owzrotg",
  "timestamp": 1779472297587,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "📝 3 条微信公众号标题建议：\n\n1. **消息分散、回复混乱？一个平台打通所有渠道，让每条消息都「可追溯、可闭环」**\n2. **你的企业还在手动回复消息？用「智能体」一秒响应，多平台消息统一接入**\n3. **不止是消息聚合——企业联动平台 3 大核心能力：统一接入 × 智能回复 × 全链路追踪**",
  "media": [],
  "metadata": {
    "gotifyId": 48,
    "gotifyAppId": 2,
    "title": "gotify-q06-task",
    "priority": 5,
    "extras": {
      "openclaw": {
        "outbound": true,
        "source": "openclaw"
      }
    },
    "date": "2026-05-22T17:51:37.441969086Z"
  },
  "direction": "outbound"
}
```

#### actual Gotify user raw
```json
{
  "id": 47,
  "appid": 1,
  "message": "【pow24qsr】你现在是内容运营助手。\n任务：根据下面的 brief 生成 3 条微信公众号标题。\nbrief：产品是“企业消息联动平台”，核心卖点是“多渠道统一接入、消息可追踪、智能体自动回复”。\n",
  "title": "gotify-q06-task",
  "priority": 5,
  "date": "2026-05-22T17:51:32.986145001Z"
}
```

#### actual Gotify reply raw
```json
{
  "id": 48,
  "appid": 2,
  "message": "📝 3 条微信公众号标题建议：\n\n1. **消息分散、回复混乱？一个平台打通所有渠道，让每条消息都「可追溯、可闭环」**\n2. **你的企业还在手动回复消息？用「智能体」一秒响应，多平台消息统一接入**\n3. **不止是消息聚合——企业联动平台 3 大核心能力：统一接入 × 智能回复 × 全链路追踪**",
  "title": "gotify-q06-task",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  },
  "date": "2026-05-22T17:51:37.441969086Z"
}
```

#### transcript user text

【pow24qsr】你现在是内容运营助手。
任务：根据下面的 brief 生成 3 条微信公众号标题。
brief：产品是“企业消息联动平台”，核心卖点是“多渠道统一接入、消息可追踪、智能体自动回复”。

#### transcript assistant text

📝 3 条微信公众号标题建议：

1. **消息分散、回复混乱？一个平台打通所有渠道，让每条消息都「可追溯、可闭环」**
2. **你的企业还在手动回复消息？用「智能体」一秒响应，多平台消息统一接入**
3. **不止是消息聚合——企业联动平台 3 大核心能力：统一接入 × 智能回复 × 全链路追踪**

## Q07 返回内容结构化测试（JSON）

- status: pass
- sessionKey: `agent:main:gotify:e2e:direct:1`
- inputType: `text`

### expected sdk_inbound
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【{CORRELATION_ID}】请严格返回 JSON，对象必须包含 topic、tone、count 三个字段，其中 topic=\"gotify test\"，tone=\"formal\"，count=3。不要输出 JSON 之外的任何文字。",
  "media": [],
  "direction": "inbound",
  "metadata": {
    "caseId": "Q07",
    "promptKind": "structured_json"
  }
}
```

### expected sdk_expected_reply
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text_rule": "non_empty",
  "media": [],
  "direction": "outbound"
}
```

### expected channel_expected_payload
```json
{
  "title": "gotify-q07-json",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  }
}
```

### actual turn 1

#### actual inbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7v3tp-1mxdt7",
  "traceId": "mph7v3tp-u1xf02zd",
  "timestamp": 1779472302109,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【anreakgg】请严格返回 JSON，对象必须包含 topic、tone、count 三个字段，其中 topic=\"gotify test\"，tone=\"formal\"，count=3。不要输出 JSON 之外的任何文字。",
  "media": [],
  "metadata": {
    "id": 49,
    "appid": 1,
    "title": "gotify-q07-json",
    "priority": 5,
    "date": "2026-05-22T17:51:39.425218296Z"
  },
  "direction": "inbound"
}
```

#### actual outbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7v3tp-fqleqv",
  "traceId": "mph7v3tp-72wtbfp0",
  "timestamp": 1779472302109,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "{\"topic\":\"gotify test\",\"tone\":\"formal\",\"count\":3}",
  "media": [],
  "metadata": {
    "gotifyId": 50,
    "gotifyAppId": 2,
    "title": "gotify-q07-json",
    "priority": 5,
    "extras": {
      "openclaw": {
        "outbound": true,
        "source": "openclaw"
      }
    },
    "date": "2026-05-22T17:51:42.02236888Z"
  },
  "direction": "outbound"
}
```

#### actual Gotify user raw
```json
{
  "id": 49,
  "appid": 1,
  "message": "【anreakgg】请严格返回 JSON，对象必须包含 topic、tone、count 三个字段，其中 topic=\"gotify test\"，tone=\"formal\"，count=3。不要输出 JSON 之外的任何文字。",
  "title": "gotify-q07-json",
  "priority": 5,
  "date": "2026-05-22T17:51:39.425218296Z"
}
```

#### actual Gotify reply raw
```json
{
  "id": 50,
  "appid": 2,
  "message": "{\"topic\":\"gotify test\",\"tone\":\"formal\",\"count\":3}",
  "title": "gotify-q07-json",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  },
  "date": "2026-05-22T17:51:42.02236888Z"
}
```

#### transcript user text

【anreakgg】请严格返回 JSON，对象必须包含 topic、tone、count 三个字段，其中 topic="gotify test"，tone="formal"，count=3。不要输出 JSON 之外的任何文字。

#### transcript assistant text

{"topic":"gotify test","tone":"formal","count":3}

## Q08 返回内容结构化测试（Markdown 表格）

- status: pass
- sessionKey: `agent:main:gotify:e2e:direct:1`
- inputType: `text`

### expected sdk_inbound
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "markdown",
  "text": "【{CORRELATION_ID}】请输出一个 2 列 3 行的 Markdown 表格，列名为“字段”和“说明”，内容围绕 Gotify 测试。",
  "markdown": "| 字段 | 说明 |\n| --- | --- |\n| 渠道 | Gotify |\n| 用途 | 测试 |",
  "media": [],
  "direction": "inbound",
  "metadata": {
    "caseId": "Q08",
    "promptKind": "markdown_table"
  }
}
```

### expected sdk_expected_reply
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "markdown",
  "text_rule": "non_empty",
  "media": [],
  "direction": "outbound"
}
```

### expected channel_expected_payload
```json
{
  "title": "gotify-q08-table",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  }
}
```

### actual turn 1

#### actual inbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7v83a-p98dml",
  "traceId": "mph7v83a-dml3n6cq",
  "timestamp": 1779472307638,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【dixxmj9v】请输出一个 2 列 3 行的 Markdown 表格，列名为“字段”和“说明”，内容围绕 Gotify 测试。",
  "media": [],
  "metadata": {
    "id": 51,
    "appid": 1,
    "title": "gotify-q08-table",
    "priority": 5,
    "date": "2026-05-22T17:51:44.143572965Z"
  },
  "direction": "inbound"
}
```

#### actual outbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7v83a-upj0l7",
  "traceId": "mph7v83a-hzz043hh",
  "timestamp": 1779472307638,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "markdown",
  "text": "| 字段 | 说明 |\n|------|------|\n| 消息ID | 每条 Gotify 消息的唯一标识符 |\n| 通道类型 | 消息通过 Gotify API 推送到达 |\n| 智能体响应 | 消息接收后由 main 智能体自动处理并回复 |",
  "markdown": "| 字段 | 说明 |\n|------|------|\n| 消息ID | 每条 Gotify 消息的唯一标识符 |\n| 通道类型 | 消息通过 Gotify API 推送到达 |\n| 智能体响应 | 消息接收后由 main 智能体自动处理并回复 |",
  "media": [],
  "metadata": {
    "gotifyId": 52,
    "gotifyAppId": 2,
    "title": "gotify-q08-table",
    "priority": 5,
    "extras": {
      "openclaw": {
        "outbound": true,
        "source": "openclaw"
      }
    },
    "date": "2026-05-22T17:51:47.503037758Z"
  },
  "direction": "outbound"
}
```

#### actual Gotify user raw
```json
{
  "id": 51,
  "appid": 1,
  "message": "【dixxmj9v】请输出一个 2 列 3 行的 Markdown 表格，列名为“字段”和“说明”，内容围绕 Gotify 测试。",
  "title": "gotify-q08-table",
  "priority": 5,
  "date": "2026-05-22T17:51:44.143572965Z"
}
```

#### actual Gotify reply raw
```json
{
  "id": 52,
  "appid": 2,
  "message": "| 字段 | 说明 |\n|------|------|\n| 消息ID | 每条 Gotify 消息的唯一标识符 |\n| 通道类型 | 消息通过 Gotify API 推送到达 |\n| 智能体响应 | 消息接收后由 main 智能体自动处理并回复 |",
  "title": "gotify-q08-table",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  },
  "date": "2026-05-22T17:51:47.503037758Z"
}
```

#### transcript user text

【dixxmj9v】请输出一个 2 列 3 行的 Markdown 表格，列名为“字段”和“说明”，内容围绕 Gotify 测试。

#### transcript assistant text

| 字段 | 说明 |
|------|------|
| 消息ID | 每条 Gotify 消息的唯一标识符 |
| 通道类型 | 消息通过 Gotify API 推送到达 |
| 智能体响应 | 消息接收后由 main 智能体自动处理并回复 |

## Q09 带角色要求的客服回复测试

- status: pass
- sessionKey: `agent:main:gotify:e2e:direct:1`
- inputType: `text`

### expected sdk_inbound
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【{CORRELATION_ID}】你现在扮演一个冷静专业的售后客服。用户投诉：'昨晚提交的数据今天还没同步成功。' 请给出一段 80 字以内的安抚和处理回复。",
  "media": [],
  "direction": "inbound",
  "metadata": {
    "caseId": "Q09",
    "promptKind": "role_reply"
  }
}
```

### expected sdk_expected_reply
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text_rule": "non_empty",
  "media": [],
  "direction": "outbound"
}
```

### expected channel_expected_payload
```json
{
  "title": "gotify-q09-role",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  }
}
```

### actual turn 1

#### actual inbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7vbxq-29km6c",
  "traceId": "mph7vbxq-76lvevdz",
  "timestamp": 1779472312622,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【v73ay61t】你现在扮演一个冷静专业的售后客服。用户投诉：'昨晚提交的数据今天还没同步成功。' 请给出一段 80 字以内的安抚和处理回复。",
  "media": [],
  "metadata": {
    "id": 53,
    "appid": 1,
    "title": "gotify-q09-role",
    "priority": 5,
    "date": "2026-05-22T17:51:49.348149509Z"
  },
  "direction": "inbound"
}
```

#### actual outbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7vbxr-kgedcs",
  "traceId": "mph7vbxr-3svrfgpu",
  "timestamp": 1779472312623,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "很抱歉给您带来不便，我已记录您昨晚提交的数据同步问题，正在加急排查处理，预计 2 小时内给出反馈，请耐心等待。",
  "media": [],
  "metadata": {
    "gotifyId": 54,
    "gotifyAppId": 2,
    "title": "gotify-q09-role",
    "priority": 5,
    "extras": {
      "openclaw": {
        "outbound": true,
        "source": "openclaw"
      }
    },
    "date": "2026-05-22T17:51:52.583392885Z"
  },
  "direction": "outbound"
}
```

#### actual Gotify user raw
```json
{
  "id": 53,
  "appid": 1,
  "message": "【v73ay61t】你现在扮演一个冷静专业的售后客服。用户投诉：'昨晚提交的数据今天还没同步成功。' 请给出一段 80 字以内的安抚和处理回复。",
  "title": "gotify-q09-role",
  "priority": 5,
  "date": "2026-05-22T17:51:49.348149509Z"
}
```

#### actual Gotify reply raw
```json
{
  "id": 54,
  "appid": 2,
  "message": "很抱歉给您带来不便，我已记录您昨晚提交的数据同步问题，正在加急排查处理，预计 2 小时内给出反馈，请耐心等待。",
  "title": "gotify-q09-role",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  },
  "date": "2026-05-22T17:51:52.583392885Z"
}
```

#### transcript user text

【v73ay61t】你现在扮演一个冷静专业的售后客服。用户投诉：'昨晚提交的数据今天还没同步成功。' 请给出一段 80 字以内的安抚和处理回复。

#### transcript assistant text

很抱歉给您带来不便，我已记录您昨晚提交的数据同步问题，正在加急排查处理，预计 2 小时内给出反馈，请耐心等待。

## Q10 多轮上下文记忆测试

- status: pass
- sessionKey: `agent:main:gotify:e2e:direct:1`
- inputType: `multi_turn`

### expected sdk_inbound
```json
[
  {
    "source": {
      "channel": "gotify",
      "accountId": "{ACCOUNT_ID}",
      "userId": "{PEER_ID}",
      "chatType": "direct",
      "agentId": "main"
    },
    "contentType": "text",
    "text": "【{CORRELATION_ID}】请记住编号 ZX-{CORRELATION_ID}，只回复“记住了”。",
    "media": [],
    "direction": "inbound",
    "metadata": {
      "caseId": "Q10",
      "turn": 1,
      "promptKind": "memory"
    }
  },
  {
    "source": {
      "channel": "gotify",
      "accountId": "{ACCOUNT_ID}",
      "userId": "{PEER_ID}",
      "chatType": "direct",
      "agentId": "main"
    },
    "contentType": "text",
    "text": "我刚才让你记住的编号是什么？只回复编号本身。",
    "media": [],
    "direction": "inbound",
    "metadata": {
      "caseId": "Q10",
      "turn": 2,
      "promptKind": "memory"
    }
  }
]
```

### expected sdk_expected_reply
```json
{
  "source": {
    "channel": "gotify",
    "accountId": "{ACCOUNT_ID}",
    "userId": "{PEER_ID}",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text_rule": "non_empty",
  "media": [],
  "direction": "outbound"
}
```

### expected channel_expected_payload
```json
{
  "title": "gotify-q10-multi-turn",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  }
}
```

### actual turn 1

#### actual inbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7vfv2-c6r3ey",
  "traceId": "mph7vfv2-rbu18vuw",
  "timestamp": 1779472317710,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "【5snp4nkh】请记住编号 ZX-5snp4nkh，只回复“记住了”。",
  "media": [],
  "metadata": {
    "id": 55,
    "appid": 1,
    "title": "gotify-q10-multi-turn",
    "priority": 5,
    "date": "2026-05-22T17:51:54.310924261Z"
  },
  "direction": "inbound"
}
```

#### actual outbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7vfv2-ghhzwu",
  "traceId": "mph7vfv2-0jwo1g84",
  "timestamp": 1779472317710,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "记住了",
  "media": [],
  "metadata": {
    "gotifyId": 56,
    "gotifyAppId": 2,
    "title": "gotify-q10-multi-turn",
    "priority": 5,
    "extras": {
      "openclaw": {
        "outbound": true,
        "source": "openclaw"
      }
    },
    "date": "2026-05-22T17:51:57.498055554Z"
  },
  "direction": "outbound"
}
```

#### actual Gotify user raw
```json
{
  "id": 55,
  "appid": 1,
  "message": "【5snp4nkh】请记住编号 ZX-5snp4nkh，只回复“记住了”。",
  "title": "gotify-q10-multi-turn",
  "priority": 5,
  "date": "2026-05-22T17:51:54.310924261Z"
}
```

#### actual Gotify reply raw
```json
{
  "id": 56,
  "appid": 2,
  "message": "记住了",
  "title": "gotify-q10-multi-turn",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  },
  "date": "2026-05-22T17:51:57.498055554Z"
}
```

#### transcript user text

【5snp4nkh】请记住编号 ZX-5snp4nkh，只回复“记住了”。

#### transcript assistant text

记住了

### actual turn 2

#### actual inbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7vir9-0pz4gk",
  "traceId": "mph7vir9-bxq6t4j9",
  "timestamp": 1779472321461,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "我刚才让你记住的编号是什么？只回复编号本身。",
  "media": [],
  "metadata": {
    "id": 57,
    "appid": 1,
    "title": "gotify-q10-multi-turn",
    "priority": 5,
    "date": "2026-05-22T17:51:59.425344472Z"
  },
  "direction": "inbound"
}
```

#### actual outbound UnifiedMessage
```json
{
  "messageId": "gotify-mph7vir9-ywt4n9",
  "traceId": "mph7vir9-nrbygst4",
  "timestamp": 1779472321461,
  "source": {
    "channel": "gotify",
    "accountId": "e2e",
    "userId": "1",
    "chatType": "direct",
    "agentId": "main"
  },
  "contentType": "text",
  "text": "记住了",
  "media": [],
  "metadata": {
    "gotifyId": 56,
    "gotifyAppId": 2,
    "title": "gotify-q10-multi-turn",
    "priority": 5,
    "extras": {
      "openclaw": {
        "outbound": true,
        "source": "openclaw"
      }
    },
    "date": "2026-05-22T17:51:57.498055554Z"
  },
  "direction": "outbound"
}
```

#### actual Gotify user raw
```json
{
  "id": 57,
  "appid": 1,
  "message": "我刚才让你记住的编号是什么？只回复编号本身。",
  "title": "gotify-q10-multi-turn",
  "priority": 5,
  "date": "2026-05-22T17:51:59.425344472Z"
}
```

#### actual Gotify reply raw
```json
{
  "id": 56,
  "appid": 2,
  "message": "记住了",
  "title": "gotify-q10-multi-turn",
  "priority": 5,
  "extras": {
    "openclaw": {
      "outbound": true,
      "source": "openclaw"
    }
  },
  "date": "2026-05-22T17:51:57.498055554Z"
}
```

#### transcript user text

我刚才让你记住的编号是什么？只回复编号本身。

#### transcript assistant text

ZX-5snp4nkh
