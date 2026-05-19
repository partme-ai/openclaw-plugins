# TEMPLATE_LABEL

**OpenClaw 插件 — TEMPLATE_DESCRIPTION**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--TEMPLATE_NAME-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

[English](./README.md) | [简体中文](./README_CN.md)

## 简介

TEMPLATE_LABEL（`@partme.ai/openclaw-TEMPLATE_NAME`）是 [OpenClaw](https://github.com/openclaw/openclaw) 的插件，用于...

### 核心能力

- 功能 1
- 功能 2

## 快速开始

### 前置条件

- [OpenClaw](https://github.com/openclaw/openclaw) **2026.2.24+**
- **Node.js 22+**

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-TEMPLATE_NAME
```

### 配置

```jsonc
{
  "plugins": {
    "entries": {
      "openclaw-TEMPLATE_NAME": {
        "enabled": true,
        "config": {
          // 配置项
        }
      }
    }
  }
}
```

## 配置参考

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `false` | 启用插件 |

## 开发

```bash
pnpm install
pnpm build
pnpm test
```

## 许可证

本项目基于 [MIT License](LICENSE) 许可。

## 链接

- [OpenClaw 文档](https://docs.openclaw.ai)
- [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins)
