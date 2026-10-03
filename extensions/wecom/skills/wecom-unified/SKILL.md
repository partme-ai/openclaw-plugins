---
name: wecom-unified
description: "用户明确要求通过企业微信处理通讯录、消息、文档、日程、会议或待办时，使用已由管理员安装并授权的 wecom-cli。"
---

# 企业微信套件 (WeCom Unified)

企业微信 CLI (`wecom-cli`) 全能套件，通过命令行工具与企业微信系统交互，覆盖 6 大业务域：通讯录、消息、文档（含文档/智能表格/智能文档 3 种品类）、日程、会议、待办。

## ⚠️ 前置检查 — 使用任何命令前必须执行

### Step 1: 检查 CLI 是否安装

```bash
wecom-cli --version
```

如果命令不存在或报错，停止本次 CLI 操作，告知用户由管理员按当前官方安装文档选择版本并安装；Agent 不执行全局安装。

### Step 2: 检查凭证是否配置

```bash
wecom-cli auth show --auth-status
```

- 输出 `authorized` → 已配置，可以继续使用
- 输出 `unauthorized` → 未配置，需要用户完成 Step 3

### Step 3: 配置凭证（仅未授权时执行）

请用户在可信终端按企业微信 CLI 文档自行完成交互式授权。Agent 不执行初始化命令，也不读取或转发凭据、授权链接和二维码。

---

## 业务域概览

### 👤 通讯录 (contact)

获取可见范围成员列表、按姓名/别名搜索匹配、查询 userid。

→ 详见 [references/wecom-contact.md](references/wecom-contact.md)

### 💬 消息 (msg)

会话列表查询、消息记录拉取（文本/图片/文件/语音/视频）、多媒体文件获取、文本消息发送。

→ 详见 [references/wecom-msg.md](references/wecom-msg.md)

### 📄 文档、智能表格 & 智能文档 (doc)

文档创建/读取/编辑（Markdown 格式），智能表格子表管理、字段/列管理、记录增删改查，智能文档（智能主页）创建与内容导出。支持通过 docid 或 URL 定位文档，自动识别文档品类（文档/智能表格/智能文档）并路由到正确接口。

→ 详见 [references/wecom-doc.md](references/wecom-doc.md)

### 📅 日程 (schedule)

查询日程列表与详情、创建/修改/取消日程、添加/移除参与人、查询多成员闲忙状态并分析共同空闲时段。

→ 详见 [references/wecom-schedule.md](references/wecom-schedule.md)

### 🎥 会议 (meeting)

创建预约会议、查询会议列表与详情、取消会议、更新受邀成员。

→ 详见 [references/wecom-meeting.md](references/wecom-meeting.md)

### ✅ 待办 (todo)

查询待办列表与详情、创建/更新/删除待办、变更用户处理状态（接受/拒绝/完成）、分派任务。

→ 详见 [references/wecom-todo.md](references/wecom-todo.md)

---

## 公共概念与规则

所有业务域共享的通用调用格式、返回格式、错误处理、通讯录查询方法和时间格式规范。

→ 详见 [references/wecom-shared.md](references/wecom-shared.md)

---

## 快速示例

### 查询通讯录成员

```bash
wecom-cli contact get_userlist '{}'
```

### 查看最近会话列表

```bash
wecom-cli msg get_msg_chat_list '{"begin_time": "2026-04-08 00:00:00", "end_time": "2026-04-15 23:59:59"}'
```

### 发送文本消息

```bash
wecom-cli msg send_message '{"chat_type": 1, "chatid": "zhangsan", "msgtype": "text", "text": {"content": "hello"}}'
```

### 创建文档

```bash
wecom-cli doc create_doc '{"doc_type": 3, "doc_name": "项目周报"}'
```

### 读取文档内容（Markdown 格式）

```bash
wecom-cli doc get_doc_content '{"docid": "DOCID", "type": 2}'
```

### 创建智能文档（智能主页）

> ⚠️ **特殊语法**：此命令必须使用 `+smartpage_create`（带 `+` 前缀），加号不可省略；该 `+` 仅适用于此命令，不要泛化到其他 `doc` 子命令。

```bash
wecom-cli doc +smartpage_create '{"title": "项目概览", "pages": [{"page_title": "需求文档", "content_type": 1, "page_filepath": "/path/to/requirements.md"}]}'
```

### 导出智能文档内容

```bash
wecom-cli doc smartpage_export_task '{"docid": "DOCID", "content_type": 1}'
```

### 查询今天的日程

```bash
wecom-cli schedule get_schedule_list_by_range '{"start_time": "2026-04-15 00:00:00", "end_time": "2026-04-15 23:59:59"}'
```

### 创建预约会议

```bash
wecom-cli meeting create_meeting '{"title": "周例会", "meeting_start_datetime": "2026-04-16 15:00", "meeting_duration": 3600}'
```

### 查看待办列表

```bash
wecom-cli todo get_todo_list '{}'
```

### 创建待办

```bash
wecom-cli todo create_todo '{"content": "完成Q2规划文档", "remind_time": "2026-04-20 09:00:00"}'
```
