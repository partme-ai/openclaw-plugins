---
name: wecom-preflight
description: 企业微信插件前置条件只读检查。仅在用户要求使用 wecom_mcp 且工具不可用时，检查当前配置并向用户说明所需的管理员操作；不得自行扩大工具权限或重启 Gateway。
---

# 企业微信前置条件检查

> 本技能只诊断 `wecom_mcp` 的可用性。工具不可用时停止调用并告知用户；不得自行修改工具授权配置。

## 触发条件

当满足以下**任一条件**时，执行前置检查：

1. 用户明确要求企业微信操作，而当前会话看不到 `wecom_mcp` 工具
2. 调用 `wecom_mcp` 时收到 `tool not allowed`、`not permitted`、`permission denied` 或类似权限错误

> 如果当前会话中已成功调用过 `wecom_mcp`（任何操作），则无需重复检查。

---

## 检查流程

> **重要**：以下所有步骤均为 **shell 命令**（在终端中执行），**不是** MCP tool 调用。
> `wecom_mcp` 在未加入白名单前对 AI Agent 不可见，因此不能用 tool 调用来探测。

### 步骤 1：检查 tools.profile

在终端执行以下命令，读取当前 `tools.profile` 配置：

```bash
openclaw config get tools.profile
```

根据返回结果分流：

- **返回 `full`** → ✅ **检查通过**。`full` 模式无任何工具限制，所有工具（包括 `wecom_mcp`）直接可用，无需检查 `alsoAllow`，继续执行用户原始请求
- **返回其他值**（如 `coding`、`messaging`、`minimal`、`undefined` 或空）→ 进入步骤 1b（检查 alsoAllow）
- **命令执行失败**（如 `command not found: openclaw`、权限错误等）→ 进入步骤 3（环境异常）

### 步骤 1b：检查 tools.alsoAllow

在终端执行以下命令，读取当前 `tools.alsoAllow` 配置：

```bash
openclaw config get tools.alsoAllow
```

根据返回结果分流：

- **返回内容包含 `wecom_mcp`**（如 `["wecom_mcp"]` 或 `["wecom_mcp", "other_tool"]`）→ ✅ 白名单已配置，检查通过，继续执行用户原始请求
- **返回内容不包含 `wecom_mcp`**（如空数组 `[]`、`undefined`、或列表中没有 `wecom_mcp`）→ 进入步骤 2（报告管理员操作）
- **命令执行失败** → 进入步骤 3（环境异常）

---

### 步骤 2：报告管理员操作

告知用户当前配置未授权 `wecom_mcp`，因此本次企业微信操作无法继续。请具有 OpenClaw 配置管理权限的人核对 `tools.profile` 与 `tools.alsoAllow`，在保留既有授权的前提下自行决定是否加入 `wecom_mcp`，然后按其部署流程重启 Gateway。不要由 Agent 执行配置写入、安装或重启，也不要把 `tools.profile` 自动改为 `full`。

---

### 步骤 3：环境异常处理

如果步骤 1 或 1b 的 `openclaw` 命令本身执行失败（如 `command not found`、权限不足等），说明 OpenClaw CLI 未正确安装或不在 PATH 中，直接告知用户：

```
⚠️ OpenClaw CLI 不可用：<错误信息>

可能原因：
- OpenClaw 未安装或未加入系统 PATH
- OpenClaw 版本过低，不支持 config 子命令
- 当前 shell 环境缺少必要配置

请检查 OpenClaw 安装状态后重试。
参考：https://docs.openclaw.dev/installation
```

---

## 注意事项

1. **只读检查**：仅使用 `openclaw config get` 读取当前配置；不要执行任何配置写入、安装或重启命令
2. **profile 优先判断**：`tools.profile` 为 `full` 时所有工具无限制，无需检查 `alsoAllow`，可快速跳过
3. **最小权限**：只向管理员说明缺失的工具名，不要求切换为 `full` profile
4. **保留已有配置**：管理员若选择修改授权，应保留列表中已有的其他工具名
5. **不自动重启**：任何 Gateway 重启都由用户或管理员按部署流程执行
6. **会话缓存**：在同一个会话中，一旦检查通过（profile 为 full 或 alsoAllow 包含 wecom_mcp），后续调用无需重复检查

---

## 快速参考

| 场景 | 处理方式 |
|------|---------|
| 用户要求使用 wecom_mcp 且工具不可见 | 执行 `openclaw config get tools.profile` 只读检查 |
| `tools.profile` 为 `full` | ✅ 跳过，直接执行原始请求 |
| profile 非 full + alsoAllow 已包含 wecom_mcp | ✅ 跳过，继续执行 |
| profile 非 full + alsoAllow 不包含 | 停止操作并告知用户联系配置管理员 |
| openclaw CLI 不可用 | 告知用户检查 OpenClaw 安装 |
| 会话中已成功调用过 wecom_mcp | 跳过检查 |
