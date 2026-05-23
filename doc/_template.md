# TEMPLATE_NAME Configuration Guide

## Overview

Brief description of what this plugin does and which platform it connects to.

## Prerequisites

- OpenClaw `>= YYYY.M.D`
- Platform account / API credentials

## Quick Start

```bash
openclaw plugins install @partme.ai/TEMPLATE_NAME
```

## Configuration

### Minimal

```json
{
  "channels": {
    "TEMPLATE_NAME": {
      "enabled": true,
      "appId": "your-app-id",
      "appSecret": "your-app-secret"
    }
  }
}
```

### Full

```json
{
  "channels": {
    "TEMPLATE_NAME": {
      "enabled": true,
      "name": "Display Name",
      "appId": "your-app-id",
      "appSecret": "your-app-secret",
      "dmPolicy": "open",
      "groupPolicy": "open",
      "accounts": {
        "default": {
          "appId": "...",
          "appSecret": "..."
        }
      }
    }
  }
}
```

## Config Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable the channel |
| `name` | string | — | Display name |
| `dmPolicy` | string | `"open"` | DM access: `open` / `pairing` / `allowlist` / `disabled` |
| `groupPolicy` | string | `"open"` | Group access: `open` / `allowlist` / `disabled` |
| `allowFrom` | string[] | `[]` | DM allowlist |
| `defaultAccount` | string | `"default"` | Default account ID |
| `accounts` | object | — | Multi-account config |

## Multi-Account

```json
{
  "accounts": {
    "main": { "appId": "...", "appSecret": "..." },
    "support": { "appId": "...", "appSecret": "..." }
  }
}
```

## Webhook Setup

1. Go to platform admin console
2. Create a bot / application
3. Set webhook URL: `https://your-domain.com/TEMPLATE_NAME`
4. Record the credentials

## Troubleshooting

### Common error: TBD

Add platform-specific common errors and solutions here.
