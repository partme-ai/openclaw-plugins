# Gotify 完整技术参考

> 本文档基于 Gotify 官方文档、API 参考、DeepWiki 分析及源码阅读，提供 Gotify 服务端的完整技术概览。

---

## 目录

1. [概述](#概述)
2. [核心架构](#核心架构)
3. [消息模型](#消息模型)
4. [REST API 全览](#rest-api-全览)
5. [认证系统](#认证系统)
6. [WebSocket 流](#websocket-流)
7. [消息扩展 (Message Extras)](#消息扩展-message-extras)
8. [插件系统](#插件系统)
9. [配置系统](#配置系统)
10. [数据库](#数据库)
11. [前端架构](#前端架构)
12. [开发与构建](#开发与构建)
13. [部署](#部署)
14. [gotify/cli](#gotifycli)
15. [gotify/android](#gotifyandroid)
16. [源码结构](#源码结构)

---

## 概述

**Gotify** 是一个自托管的开源推送通知服务器，采用 **Go** (后端) + **TypeScript/React** (前端) 技术栈，通过 **WebSocket** 实现实时消息推送。

- **仓库**: [github.com/gotify/server](https://github.com/gotify/server)
- **许可证**: MIT
- **版本策略**: SemVer

### 核心组件

| 组件 | 仓库 | 说明 |
|------|------|------|
| gotify/server | [gotify/server](https://github.com/gotify/server) | 中央服务器 (WebUI + REST API + WebSocket) |
| gotify/cli | [gotify/cli](https://github.com/gotify/cli) | 命令行消息发送工具 (Go) |
| gotify/android | [gotify/android](https://github.com/gotify/android) | Android 推送通知客户端 |

---

## 核心架构

### 三实体模型

Gotify 的核心设计基于三个角色分离的实体：

```
┌──────────┐         ┌──────────────┐         ┌──────────┐
│   User   │──owns──▶│ Application  │──sends──▶│ Message  │
│  (所有者) │         │   (生产者)    │         │          │
└──────────┘         └──────────────┘         └──────────┘
     │                                               │
     │ owns                                          │ receive
     ▼                                               ▼
┌──────────┐                                  ┌──────────┐
│  Client  │───────────manage─────────────────▶│ Message  │
│ (消费者)  │                                   │          │
└──────────┘                                   └──────────┘
```

| 实体 | 角色 | 认证凭证 | 权限 |
|------|------|----------|------|
| **User** | 账户所有者 | 用户名/密码 (Basic Auth) | 创建并管理自己的 Application 和 Client |
| **Application** | 消息生产者 | App Token (前缀 `A`) | 仅能发送消息，无管理权限 |
| **Client** | 消息消费者 & 管理器 | Client Token (前缀 `C`) | 接收消息，管理 Application/Client/Message |

### 关键设计约束

- **数据隔离**: User 只能查看和管理自己创建的 Application 和 Client
- **Token 不可互换**: App Token 和 Client Token 不能交叉使用
- **权限最小化**: Application 只有写 (发送) 权限，Client 有读 (接收) 和管理权限

---

## 消息模型

### 内部模型 (`model.Message`)

```go
type Message struct {
    ID            uint      `gorm:"autoIncrement;primaryKey;index"`
    ApplicationID uint
    Message       string    `gorm:"type:text"`
    Title         string    `gorm:"type:text"`
    Priority      int
    Extras        []byte    // JSON 序列化存储
    Date          time.Time
}
```

### 外部模型 (`model.MessageExternal`)

```typescript
interface MessageExternal {
  id: number;                    // 消息 ID (服务端分配)
  appid: number;                 // 发送方 Application ID
  message: string;               // 正文 (支持 Markdown，排除 HTML)
  title?: string;                // 标题 (为空时使用 Application name)
  priority?: number;             // 优先级 (为空时使用 Application 的 defaultPriority)
  extras?: Record<string, any>;  // 扩展元数据 (仅 application/json 请求)
  date: string;                  // ISO 8601 创建时间
}
```

### 优先级

- 消息优先级为整数，无固定范围限制
- 若消息未指定优先级，使用 Application 的 `defaultPriority` (默认为 0)
- 客户端可根据优先级显示不同级别的通知

---

## REST API 全览

### 基础信息

- **Base URL**: `http(s)://<host>:<port>/`
- **Content-Type**: `application/json`
- **响应格式**: JSON (统一使用 `{ error, data }` 结构)

### 消息 API

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/message` | 🔑 App Token | 创建消息。Body: `{ message (必填), title, priority, extras }` |
| `GET` | `/message` | 🔵 Client Token | 游标分页获取消息。Query: `limit` (1-200, 默认100), `since` (消息ID) |
| `DELETE` | `/message` | 🔵 Client Token | 删除当前用户的所有消息 |
| `DELETE` | `/message/{id}` | 🔵 Client Token | 按 ID 删除单条消息 |
| `GET` | `/application/{id}/message` | 🔵 Client Token | 获取特定 Application 的消息 (支持分页) |
| `DELETE` | `/application/{id}/message` | 🔵 Client Token | 删除特定 Application 的所有消息 |

**分页机制** (游标分页):
1. API 请求 `limit+1` 条消息
2. 若返回超过 `limit` 条，移除最后一条
3. 最后返回消息的 ID 作为下一页的 `since` 参数
4. 响应中包含 `next` URL 供翻页
5. 消息按 ID 降序排列 (最新在前)

### Application API

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/application` | 🔵 Client Token | 列出当前用户的所有 Application |
| `POST` | `/application` | 🔵 Client Token | 创建 Application。Body: `{ name (必填), description, defaultPriority }` |
| `PUT` | `/application/{id}` | 🔵 Client Token | 更新 Application (name, description, defaultPriority) |
| `DELETE` | `/application/{id}` | 🔵 Client Token | 删除 Application 及其所有消息 (Internal 应用不可删除) |
| `POST` | `/application/{id}/image` | 🔵 Client Token | 上传应用图标 (仅 .gif/.png/.jpg/.jpeg) |
| `DELETE` | `/application/{id}/image` | 🔵 Client Token | 删除自定义图标，恢复默认 |

### Client API

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/client` | 🔵 Client Token | 列出当前用户的所有 Client |
| `POST` | `/client` | 🔵 Client Token | 创建 Client。Body: `{ name (必填) }` |
| `PUT` | `/client/{id}` | 🔵 Client Token | 更新 Client 名称 |
| `DELETE` | `/client/{id}` | 🔵 Client Token | 删除 Client |

### User API

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/user` | 🟢 Optional | 创建用户 (需 `Registration` 开启才能匿名注册) |
| `GET` | `/user` | 🔴 Admin | 列出所有用户 |
| `GET` | `/user/{id}` | 🔴 Admin | 按 ID 获取用户 |
| `POST` | `/user/{id}` | 🔴 Admin | 更新用户 (name, admin, pass) |
| `DELETE` | `/user/{id}` | 🔴 Admin | 删除用户 |
| `GET` | `/current/user` | 🔵 Client Token | 获取当前登录用户信息 |
| `POST` | `/current/user/password` | 🔵 Client Token | 修改自己的密码 |

**管理员保护机制**:
- 不允许删除最后一个 admin 用户
- 不允许移除最后一个 admin 用户的管理员权限

### 其他端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/stream` | WebSocket 升级端点 — 实时消息流 |
| `GET` | `/version` | 获取版本信息 |
| `GET` | `/health` | 健康检查 (无需认证) |
| `GET` | `/swagger` | Swagger API 规范 (JSON) |
| `GET` | `/docs` | API 文档 UI |
| `GET`/`POST` | `/plugin/*` | 插件管理接口 |

### 用户模型

```typescript
// 公共用户信息 (不含密码)
interface UserExternal {
  id: number;
  name: string;
  admin: boolean;
}

// 创建用户请求
interface CreateUserExternal {
  name: string;    // 必填
  pass: string;    // 必填
  admin: boolean;
}

// 更新用户请求
interface UpdateUserExternal {
  name: string;    // 必填
  admin: boolean;
  pass?: string;   // 为空则保留旧密码
}
```

### Application 模型

```typescript
interface Application {
  id: number;
  token: string;           // 只读，以 "A" 开头
  name: string;            // 必填
  description?: string;
  internal: boolean;       // 只读，内置应用不可删除
  image: string;           // 只读，图标路径
  defaultPriority: number; // 默认 0
  lastUsed?: string;       // ISO 8601，Token 最后使用时间
  sortKey: string;         // 排序键 (fractional indexing)
}
```

### Client 模型

```typescript
interface Client {
  id: number;
  token: string;    // 只读，以 "C" 开头
  name: string;     // 必填
  lastUsed?: string; // ISO 8601
}
```

---

## 认证系统

### Token 传递方式

四种认证方式，按优先级：

1. **Query 参数**: `?token=<token>`
2. **X-Gotify-Key 头**: `X-Gotify-Key: <token>`
3. **Authorization Bearer**: `Authorization: Bearer <token>`
4. **HTTP Basic Auth**: 用户名/密码 (仅 Client 操作)

源码实现 (`auth/authentication.go`):

```go
func (a *Auth) tokenFromQueryOrHeader(ctx *gin.Context) string {
    if token := a.tokenFromQuery(ctx); token != "" {
        return token
    } else if token := a.tokenFromXGotifyHeader(ctx); token != "" {
        return token
    } else if token := a.tokenFromAuthorizationHeader(ctx); token != "" {
        return token
    }
    return ""
}
```

### Token 生成

```go
// Token 前缀区分类型
Application Token:  "A" + random    // 例: "A4ZudDRdLT40L5X"
Client Token:       "C" + random    // 例: "CWH0wZ5r0Mbac.r"
Plugin Token:       随机生成
```

生成逻辑: `auth.GenerateNotExistingToken()` — 循环生成直到数据库中不存在重复。

### 认证中间件

| 中间件 | 要求 | 适用场景 |
|--------|------|----------|
| `RequireApplicationToken()` | App Token 或 admin 用户 | `POST /message` |
| `RequireClient()` | Client Token 或有效用户登录 | Application/Client/Message 管理 |
| `RequireAdmin()` | Client Token + admin 用户 | User 管理 |
| `Optional()` | 尝试认证但不强制 | `POST /user` (注册) |

### LastUsed 更新

为减少数据库写入，Token 的 `lastUsed` 字段采用 5 分钟冷却更新策略 —— 仅在距上次更新超过 5 分钟时才写入。

---

## WebSocket 流

### 连接流程

```
Client                          Gotify Server
  │                                   │
  │──── GET /stream ────────────────▶│  1. Client Token 认证
  │                                   │  2. HTTP → WebSocket 升级
  │◀─── 101 Switching Protocols ────│
  │                                   │  3. 注册 client 实例
  │◀═══ PING (每 500ms) ═══════════│  4. 启动 read/write goroutine
  │                                   │
  │◀═══ JSON Message ══════════════│  5. 实时推送消息
  │◀═══ JSON Message ══════════════│
```

### 连接池

- 同一用户的多个设备可同时连接，全部收到相同的消息
- 按 UserID 分组管理连接，实现高效分发

### 连接健康检测

- **Ping 周期**: 可配置 (默认 500ms 代码硬编码，文档写 config `pingPeriodSeconds: 45`)
- **超时**: 15 秒无 pong 响应则关闭连接
- 大多数 WebSocket 库自动处理 ping/pong

### 连接终止触发器

| 事件 | 行为 |
|------|------|
| 正常客户端断开 | 清理连接资源 |
| Ping 超时 | 自动关闭无响应连接 |
| 用户被删除 | `NotifyDeletedUser(userID)` → 关闭该用户所有连接 |
| Client 被删除 | `NotifyDeletedClient(userID, token)` → 关闭特定 token 的连接 |
| 服务器关闭 | `Close()` → 关闭所有连接 |

### 同源策略

- 同源请求始终允许
- 开发模式下允许所有来源
- 生产模式需在 `server.stream.allowedOrigins` 中配置

### 公共 API 方法

```go
Handle(ctx *gin.Context)                          // WebSocket 入口
Notify(userID uint, msg *model.MessageExternal)    // 推送消息给用户的所有客户端
NotifyDeletedClient(userID uint, token string)     // 关闭特定 client 连接
NotifyDeletedUser(userID uint)                     // 关闭用户所有连接
CollectConnectedClientTokens() []string            // 收集所有已连接的 client token
Close()                                            // 关闭所有连接并清理
```

---

## 消息扩展 (Message Extras)

消息扩展通过 `POST /message` 的 JSON Body 中的 `extras` 字段传递，遵循键值结构：

```
{ "extras": { "namespace::subnamespace::action": value } }
```

### 保留命名空间

| 命名空间 | 用途 |
|----------|------|
| `client::*` | 客户端行为控制 |
| `android::*` | Android 特定行为 |
| `ios::*` | iOS 预留 |
| `server::*` | 服务端预留 |
| 其他 | 用户自定义 |

### 可用扩展

#### `client::display.contentType`

控制消息渲染方式：

```json
{
  "extras": {
    "client::display": {
      "contentType": "text/markdown"
    }
  }
}
```

| 值 | 说明 |
|----|------|
| `text/plain` (默认) | 纯文本，链接可高亮可点击 |
| `text/markdown` | Markdown 渲染 (HTML 被忽略) |

> **安全提醒**: Markdown 图片 `![](url)` 在查看时自动下载，可能造成隐私泄露 (类似邮件跟踪像素)。外部来源内容建议使用 `text/plain`。

支持版本: gotify/server UI ≥ v2.0.5 (GFM), gotify/android ≥ v2.0.7 (CommonMark)

#### `client::notification.click.url`

点击通知时打开指定 URL (替代打开 Gotify App 的默认行为):

```json
{
  "extras": {
    "client::notification": {
      "click": { "url": "https://example.com" }
    }
  }
}
```

Android 支持: ≥ v2.0.10

#### `client::notification.bigImageUrl`

在展开的通知中显示大图:

```json
{
  "extras": {
    "client::notification": {
      "bigImageUrl": "https://example.com/image.jpg"
    }
  }
}
```

Android 支持: ≥ v2.3.0

#### `android::action.onReceive.intentUrl`

通知送达时立即触发 intent URL (无需用户点击):

```json
{
  "extras": {
    "android::action": {
      "onReceive": { "intentUrl": "https://example.com" }
    }
  }
}
```

> 需要在 App 设置中启用 "Intent Action Permission"，否则仅前台生效。

Android 支持: ≥ v2.0.11

---

## 插件系统

### 概述

Gotify 插件是基于 Go 原生 `plugin` 包的 **共享对象 (.so)**，在服务端进程内运行。

- **平台限制**: 仅 Linux/macOS (Go `plugin` 包限制)
- **加载方式**: 启动时扫描 `GOTIFY_PLUGINSDIR` 目录，加载所有文件
- **隔离模型**: 每个用户一个插件实例，状态完全隔离

### 核心接口

每个插件必须导出两个函数：

```go
// 返回插件元信息 (仅 ModulePath 必填)
func GetGotifyPluginInfo() plugin.Info

// 为每个用户创建插件实例
func NewGotifyPluginInstance(ctx plugin.UserContext) plugin.Plugin
```

`plugin.UserContext`:
```go
type UserContext struct {
    ID    uint
    Name  string
    Admin bool
}
```

### 能力接口

插件通过实现以下接口来获得不同能力：

| 接口 | 方法 | 用途 |
|------|------|------|
| `Plugin` (必需) | `Enable() error` / `Disable() error` | 基本生命周期 |
| `Messenger` | `SetMessageHandler(handler)` → `handler.SendMessage(msg)` | 以 Application 身份发送消息 |
| `Storager` | `SetStorageHandler(handler)` → `handler.Load()` / `handler.Save(data)` | 每个用户的 KV 持久化存储 |
| `Webhooker` | `RegisterWebhook(basePath, *gin.RouterGroup)` | 注册自定义 HTTP 路由 |
| `Configurer` | `DefaultConfig() interface{}` / `ValidateAndSetConfig(c) error` | WebUI 中 YAML 配置 |
| `Displayer` | `GetDisplay(*url.URL) string` | WebUI 中显示 Markdown 说明 |

### 插件生命周期

```
NewPluginInstance(ctx) → 加载配置 → 注册 Handler → Enable() ←→ Disable()
                                                      ↓
                                               GetDisplay()
```

### Webhook URL

每个插件实例有唯一的路径: `/plugin/{id}/custom/{token}/...`

插件禁用时，其 Webhook 路由不可达。

### 消息发送

插件通过 Messenger 接口获取 `MessageHandler`，调用 `SendMessage()` 发送消息。消息通过 channel 异步写入数据库并通知 WebSocket 客户端。

### 配置管理

- 配置以 YAML 格式存储在数据库中
- REST 端点: `GET/POST /plugin/:id/config`
- 首次使用 `DefaultConfig()` 初始化
- 配置验证失败则自动禁用插件并通知用户

### 构建与部署

需要与服务器相同的 Go 版本和构建环境：

```bash
# 推荐: 使用官方 Docker 构建镜像
docker run -v "$PWD":/plugin gotify/build

# 手动构建
go build -buildmode=plugin -ldflags="-w -s" -o myplugin-linux-amd64.so
```

部署: 将 `.so` 文件复制到 `GOTIFY_PLUGINSDIR` 目录，重启服务器。

### 插件 API 包

- 官方 API: `github.com/gotify/plugin-api`
- 模板: [github.com/gotify/plugin-template](https://github.com/gotify/plugin-template)
- 社区贡献: [github.com/gotify/contrib](https://github.com/gotify/contrib)

---

## 配置系统

### 配置加载

- 配置文件: `config.yml` (当前目录)，`/etc/gotify/config.yml`
- 环境变量: 以 `GOTIFY` 为前缀，如 `GOTIFY_SERVER_PORT=8080`
- 库: [jinzhu/configor](https://github.com/jinzhu/configor)
- dev 模式下仅加载当前目录的 `config.yml`

### 完整配置结构

```yaml
server:
  keepAlivePeriodSeconds: 0
  listenAddr: ""            # 默认 ""
  port: 80                  # 默认 80

  ssl:
    enabled: false
    redirectToHTTPS: true
    listenAddr: ""
    port: 443
    certFile: ""
    certKey: ""
    letsEncrypt:
      enabled: false
      acceptTOS: false
      cache: "data/certs"
      directoryURL: ""
      hosts: []

  responseHeaders: {}        # 自定义响应头
  stream:
    pingPeriodSeconds: 45
    allowedOrigins: []       # WebSocket 允许的来源
  cors:
    allowOrigins: []
    allowMethods: []
    allowHeaders: []
  trustedProxies: []         # 信任的代理 IP

database:
  dialect: "sqlite3"         # sqlite3 | mysql | postgres
  connection: "data/gotify.db"

defaultUser:
  name: "admin"
  pass: "admin"

passStrength: 10             # bcrypt 强度
uploadedImagesDir: "data/images"
pluginsDir: "data/plugins"
registration: false          # 是否允许自行注册
```

---

## 数据库

### 方言支持

| 方言 | 最大连接数 | 特殊配置 |
|------|-----------|----------|
| SQLite3 | 1 | 单连接避免并发写入问题 |
| MySQL | 10 | `SetConnMaxLifetime(9min)` 处理 `wait_timeout` |
| PostgreSQL | 10 | 标准配置 |

### ORM

- 使用 **GORM** v2
- 启动时自动迁移表结构 (`AutoMigrate`)
- 翻译数据库错误 (`TranslateError: true`)
- 禁用外键约束 (`DisableForeignKeyConstraintWhenMigrating: true`)

### 数据表

| 表 | 模型 | 关键字段 |
|----|------|----------|
| `users` | User | id, name (unique), pass (bcrypt), admin |
| `applications` | Application | id, token (unique), user_id, name, sort_key |
| `clients` | Client | id, token (unique), user_id, name |
| `messages` | Message | id, application_id, message, title, priority, extras (blob), date |
| `plugin_confs` | PluginConf | id, user_id, module_path, token, config (yaml), enabled |

### 初始化

首次启动且 `users` 表为空时，自动创建默认 admin 用户 (用户名和密码由 `defaultUser` 配置决定)。

---

## 前端架构

### 技术栈

- **React** + **TypeScript**
- **Vite** 构建工具
- **MobX** 状态管理
- **Vitest** 测试框架
- UI 组件位于 `ui/src/` 下按功能模块组织

### 目录结构

```
ui/src/
  index.tsx                 # 入口
  config.ts                 # 前端配置
  types.ts                  # 类型定义
  apiAuth.ts                # API 认证
  CurrentUser.ts            # 当前用户上下文
  stores.tsx                # MobX stores
  application/              # 应用管理页面
  client/                   # 客户端管理页面
  message/                  # 消息列表页面
  plugin/                   # 插件管理页面
  user/                     # 用户管理页面
  common/                   # 通用组件
  layout/                   # 布局组件
  snack/                    # 通知组件
```

### 开发模式

- 前端开发服务器: `localhost:3000` (Vite)
- API 代理到: `localhost:80` (Go 后端)
- 生产构建产物嵌入 Go 二进制文件

---

## 开发与构建

### 开发环境

**前置要求**:
- Go ≥ 1.18
- Node.js ≥ 16.x
- Yarn ≥ 1.9

**设置**:
```bash
git clone https://github.com/gotify/server.git && cd server
make download-tools    # Go 工具依赖
(cd ui && yarn)        # 前端依赖
```

### 运行与测试

```bash
# 后端 (需要先构建 UI)
(cd ui && yarn build)
go run .

# 前端开发服务器
(cd ui && yarn start)    # localhost:3000

# 后端测试
go test ./...                          # 并行测试
make test-coverage                     # 覆盖率
make test-race                         # 竞态检测

# 前端测试
(cd ui && yarn build && yarn test)     # E2E 测试需生产构建

# 静态检查
make check                             # gofmt, govet, tslint
```

### 构建

```bash
# 使用 Makefile (推荐)
make build                    # 所有平台
make build-linux-amd64        # Linux amd64
make build-linux-arm-7        # Linux ARM v7
make build-linux-arm64        # Linux ARM64
make build-windows-amd64      # Windows amd64

# 手动
go build -ldflags="-X main.Version=... -X main.BuildDate=... -X main.Commit=... -X main.Mode=prod" -o gotify-server
```

**注意**: 由于 SQLite3 的 CGO 依赖，交叉编译需要 CGO 交叉编译器。推荐使用官方 `gotify/build` Docker 镜像。

### Docker 构建

```dockerfile
# 基于 gotify/build 镜像确保插件兼容性
FROM gotify/build:1.18-linux-amd64
```

---

## 部署

### Docker (推荐)

```bash
docker run -p 80:80 -v /var/gotify/data:/app/data gotify/server
```

### systemd

```ini
# /opt/gotify/gotify.service
[Unit]
Description=Gotify
Requires=network.target
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/gotify
ExecStart=/opt/gotify/gotify
StandardOutput=append:/var/log/gotify/gotify.log
StandardError=append:/var/log/gotify/gotify.log
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir /var/log/gotify
sudo ln -s /opt/gotify/gotify.service /etc/systemd/system/gotify.service
sudo systemctl daemon-reload
sudo systemctl enable --now gotify
```

### nginx 反向代理

**域名根路径**:
```nginx
upstream gotify { server 127.0.0.1:1245; }

server {
    listen 80;
    server_name push.example.com;

    location / {
        proxy_pass http://gotify;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 1m;
        proxy_send_timeout 1m;
        proxy_read_timeout 1m;
    }
}
```

**子路径** (如 `/gotify/`):
```nginx
location /gotify/ {
    rewrite ^/gotify(/.*) $1 break;
    proxy_pass http://gotify;
    # ... 相同的 proxy 头部和超时设置
}
```

> HTTPS: 保持 `GOTIFY_SERVER_SSL_ENABLED=false`，由 nginx 处理 TLS。

---

## gotify/cli

### 安装

```bash
# 手动下载
wget -O gotify https://github.com/gotify/cli/releases/download/v2.2.0/gotify-cli-linux-amd64
chmod +x gotify

# macOS
brew install gotify

# Arch Linux
# AUR: gotify-cli
```

### 配置

配置文件搜索路径 (按顺序):
1. `/etc/gotify/cli.json`
2. `$XDG_CONFIG_HOME/gotify/cli.json`
3. `~/.gotify/cli.json`
4. `./cli.json`

```json
{
  "token": "A4ZudDRdLT40L5X",
  "url": "https://gotify.example.com",
  "defaultPriority": 6
}
```

### 命令

```bash
gotify init                                    # 初始化向导
gotify push -t "Title" -p 5 "message"         # 推送消息
echo "msg" | gotify push                       # 从 stdin 推送
gotify push -t "Title" --contentType "text/markdown" "**bold**"
gotify watch "curl -s https://api.example.com" # 监控命令输出并推送差异
gotify version                                 # 版本信息
gotify config                                  # 当前配置
```

### Docker

```bash
docker run -it -v "$PWD/cli.json:/home/app/cli.json" \
  gotify/gotify-cli:latest push -p 5 "Test message"
```

### Push 命令选项

| 选项 | 说明 |
|------|------|
| `-p, --priority` | 优先级 (默认 0) |
| `-t, --title` | 标题 (为空则使用应用名称) |
| `--token` | 覆盖 App Token (也可用 `$GOTIFY_TOKEN`) |
| `--url` | 覆盖 Gotify URL |
| `-q, --quiet` | 成功时不输出 |
| `--contentType` | 设置 content type (参考 msgextras) |
| `--disable-unescape-backslash` | 将 `\n` `\t` 视为字面量 |

### Watch 命令选项

| 选项 | 说明 |
|------|------|
| `-n, --interval` | 检查间隔 (秒，默认 2) |
| `-p, --priority` | 优先级 (默认 0) |
| `-x, --exec` | 执行命令的解释器 (默认 `sh -c`) |
| `-t, --title` | 标题 (默认使用命令字符串) |
| `-o, --output` | 详细程度: short / default / long |

---

## gotify/android

### 分发渠道

- **Google Play Store**: `com.github.gotify`
- **F-Droid**: `com.github.gotify`
- **GitHub Releases**: 直接下载 APK

### 通知能力

| 特性 | 最低版本 | 说明 |
|------|----------|------|
| Markdown 渲染 | v2.0.7 | CommonMark 规范 |
| 点击通知打开 URL | v2.0.10 | 替代打开 App 的默认行为 |
| Intent on Receive | v2.0.11 | 送达时触发 intent (需权限) |
| 大图通知 | v2.3.0 | 展开通知显示大图 |

### 项目结构

```
android/
  app/src/main/     # 主应用源码
  client/           # Gotify API 客户端库 (可独立使用)
  metadata/         # F-Droid / Google Play 上架信息
```

---

## 源码结构

### gotify/server 关键目录

```
server/
├── api/                    # HTTP 处理器
│   ├── message.go          # 消息 CRUD + 分页
│   ├── application.go      # 应用管理
│   ├── client.go           # 客户端管理
│   ├── user.go             # 用户管理 (含 last-admin 保护)
│   ├── plugin.go           # 插件 WebUI 接口
│   ├── health.go           # 健康检查
│   ├── stream/             # WebSocket 流处理
│   │   ├── stream.go       # Handle(), Notify(), Close()
│   │   ├── client.go       # 连接读写
│   │   └── once.go         # sync.Once 变体
│   ├── errorHandling.go    # 错误响应
│   └── tokens.go           # Token 相关工具
├── auth/                   # 认证与鉴权
│   ├── authentication.go   # 中间件: RequireAdmin/RequireClient/RequireApplicationToken
│   ├── token.go            # Token 生成与验证
│   ├── cors.go             # CORS 配置
│   └── password/           # bcrypt 密码管理
├── config/
│   └── config.go           # 配置加载 (configor + 环境变量)
├── database/               # GORM 数据库封装
│   ├── database.go         # New(), AutoMigrate, 连接池配置
│   ├── user.go             # 用户 CRUD
│   ├── application.go      # 应用 CRUD
│   ├── client.go           # 客户端 CRUD
│   ├── message.go          # 消息 CRUD
│   ├── plugin.go           # 插件配置 CRUD
│   └── migration_test.go   # 迁移测试
├── model/                  # 数据模型
│   ├── message.go          # Message + MessageExternal
│   ├── application.go      # Application
│   ├── client.go           # Client
│   ├── user.go             # User + UserExternal 变体
│   ├── paging.go           # Paging + PagedMessages
│   ├── pluginconf.go       # PluginConf
│   └── version.go          # VersionInfo
├── plugin/                 # 插件管理器
│   ├── manager.go          # Manager: 加载、初始化、生命周期
│   ├── compat/             # 兼容层 (v1/v2 插件)
│   ├── messagehandler.go   # 消息发送 handler
│   ├── storagehandler.go   # 持久化存储 handler
│   ├── pluginenabled.go    # 启用/禁用逻辑
│   └── example/            # 示例插件 (clock, echo, minimal)
├── router/
│   └── router.go           # 路由注册 (Gin engine 创建)
├── ui/                     # React/TypeScript 前端
│   ├── src/
│   │   ├── index.tsx       # 前端入口
│   │   ├── application/    # 应用管理页面
│   │   ├── client/         # 客户端管理页面
│   │   ├── message/        # 消息页面
│   │   ├── plugin/         # 插件页面
│   │   ├── user/           # 用户页面
│   │   └── common/         # 通用组件
│   └── serve.go            # 内嵌 UI 服务
├── docs/
│   ├── spec.json           # OpenAPI/Swagger 规范
│   └── swagger.go          # Swagger 文档生成
├── app.go                  # 应用入口
├── Makefile                # 构建脚本
└── config.example.yml      # 配置示例
```

### 路由注册顺序

```go
// router/router.go - Create()
g.Use(gin.LoggerWithFormatter(logFormatter), gin.Recovery(), gerror.Handler(), location.Default())
g.NoRoute(gerror.NotFound())

// 无需认证
g.Match([]string{"GET", "HEAD"}, "/health", healthHandler.Health)
g.GET("/swagger", docs.Serve)
g.GET("/docs", docs.UI)
g.GET("version", versionHandler)
g.StaticFS("/image", &onlyImageFS{...})

// 可选认证
g.Group("/user").Use(authentication.Optional()).POST("", userHandler.CreateUser)

// App Token (仅 POST /message)
g.Group("/").Use(authentication.RequireApplicationToken()).POST("/message", messageHandler.CreateMessage)

// Client Token (管理接口)
clientAuth := g.Group("").Use(authentication.RequireClient())
// → /application, /client, /message, /stream, /current/user

// Admin (用户管理)
authAdmin := g.Group("/user").Use(authentication.RequireAdmin())
// → /user GET/DELETE/POST

// 插件路由
g.GET("/plugin", authentication.RequireClient(), pluginHandler.GetPlugins)
g.Group("/plugin/", authentication.RequireClient())
// → /plugin/:id/config, /plugin/:id/display, /plugin/:id/enable, /plugin/:id/disable
```

### 关键设计细节

1. **Token 日志脱敏**: 日志中 URL 的 `token=` 参数自动替换为 `[masked]`
2. **健康检查免日志**: 本地 localhost 的健康检查请求不记录日志
3. **图片安全**: `/image` 路径仅允许 `.gif/.png/.jpg/.jpeg` 拓展名
4. **CGO 依赖**: SQLite3 驱动 (`mattn/go-sqlite3`) 需要 CGO
5. **分数索引**: Application 排序使用 fractional indexing (`fracdex` 包)
6. **Last-used 冷却**: Token 的 `lastUsed` 字段仅在距上次更新超过 5 分钟时才写入，减少 DB 压力
7. **Connection**: 每 5 分钟批量更新所有已连接 client token 的 `lastUsed`