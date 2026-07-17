# OpenClaw mTLS

<!-- README_STANDARD_START -->

> Standard reading order: positioning → architecture → flow → boundaries → installation → configuration → operations → deep dive.
> This block favors text diagrams that render reliably on npm; when applicable, deeper Mermaid diagrams remain in the repository's `doc/` design material.

[English](./README.md) | [简体中文](./README.zh-CN.md)

## 1. Component positioning

Provides a mutual-TLS identity boundary in front of the Gateway. Component type: **Security reverse proxy**.

| Item | Value |
|---|---|
| npm package | `@partme.ai/openclaw-mtls` |
| Version | `2026.7.1` |
| Plugin ID | `mtls` |
| Channel ID | — |
| OpenClaw | `>=2026.7.1` |
| Source | `extensions/mtls` |

## 2. At a glance

```text
[TLS client connections]
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│ Inside OpenClaw Gateway: mtls
│ 1. Validate certificate chain and client identity
│ 2. Overwrite trusted identity headers and remove spoofed values
│ 3. Proxy HTTP and WebSocket traffic to Gateway
└──────────────────────────────────────────────────────────────┘
          │
          ▼
[Authenticated Gateway requests]
```

## 3. Architecture and core flow

The component keeps protocol and platform differences inside its own boundary and exposes stable plugin, channel, hook, tool, or service contracts to OpenClaw.

```text
TLS client connections
  │
  ▼
Validate certificate chain and client identity
  │
  ▼
Overwrite trusted identity headers and remove spoofed values
  │
  ▼
Proxy HTTP and WebSocket traffic to Gateway
  │
  ▼
Authenticated Gateway requests

Failure path: Any failed stage: record a diagnosable error, then retry, reject, or degrade per component policy
```

## 4. Capabilities and boundaries

| Area | Contract |
|---|---|
| Owns | Provides a mutual-TLS identity boundary in front of the Gateway |
| Does not own | Does not issue certificates or replace Gateway authorization |
| Input | TLS client connections |
| Output | Authenticated Gateway requests |
| Failure rule | Failures remain observable; authentication, boundary validation, and persistence failures must not be reported as success |

## 5. Quick start

```bash
openclaw plugins install "@partme.ai/openclaw-mtls@2026.7.1"
```

Start with least-privilege configuration, then launch the Gateway. Validate connectivity, authorization, and recovery in an isolated profile before production use.

## 6. Configuration entry points

| Layer | Path |
|---|---|
| Plugin configuration | `plugins.entries.mtls.config` |
| Channel configuration | Not applicable |
| Configuration schema | `extensions/mtls/openclaw.plugin.json` |

Field definitions, environment variables, and complete examples remain in the preserved detailed reference below.

## 7. Operations, security, and troubleshooting

- Confirm the OpenClaw version, package version, manifest ID, and configuration key first.
- Keep credentials in environment variables or SecretRef values, never in logs, source control, or plaintext examples.
- Diagnose by layer: Gateway logs, plugin health, then the external dependency.
- Back up state before upgrades; for cursors, queues, or indexes, verify restart recovery and duplicate-delivery semantics.

## 8. Verification and deep dives

```bash
pnpm --filter "@partme.ai/openclaw-mtls" typecheck
pnpm --filter "@partme.ai/openclaw-mtls" test
pnpm --filter "@partme.ai/openclaw-mtls" build
```

- [Plugin architecture overview](../../doc/OpenClaw-Plugins-Architecture.md)
- [Unified plugin structure standard](../../doc/OpenClaw-Plugins-Structure-Standard.md)

## 9. Preserved detailed reference

The original configuration tables, protocol details, examples, and troubleshooting material continue below.

<!-- README_STANDARD_END -->


**OpenClaw plugin — mTLS (Mutual TLS) bidirectional certificate authentication**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--mtls-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)

[English](./README.md) | [简体中文](./README.zh-CN.md)

## 📖 Introduction

`@partme.ai/openclaw-mtls` is an HTTPS/mTLS reverse proxy for OpenClaw. It validates client certificates, overwrites spoofable identity headers, proxies HTTP and WebSocket traffic, and integrates with OpenClaw's official `trusted-proxy` authentication mode.

### What is mTLS?

mTLS (Mutual TLS) is a security mechanism where both the client and server authenticate each other using X.509 certificates. Unlike standard TLS where only the server presents a certificate, mTLS requires the client to present a valid certificate signed by a trusted Certificate Authority (CA).

### Core Capabilities

- **Bidirectional Authentication**: Both server and client present certificates for mutual verification
- **Client Certificate Validation**: Extract and verify client certificate CN, issuer, fingerprint
- **Whitelist Control**: Fine-grained access control via `allowedClients` (CN/issuer/fingerprint)
- **Path-Based Protection**: Configure which paths require mTLS authentication via `protectedPaths`
- **Fail-Closed Policy**: Protected routes never accept missing or unverified client certificates; public routes must be declared explicitly
- **Certificate Info Propagation**: Pass client certificate information to downstream services via HTTP headers
- **OpenClaw Integration**: Follows OpenClaw's security plugin architecture

### Architecture

```
Client (with client cert)
    → HTTPS + mTLS
    → mTLS HTTPS proxy (this plugin, default :18443)
    → Verified identity headers
    → OpenClaw Gateway (loopback :18789, trusted-proxy mode)
```

### Lifecycle

- Plugin starts a dedicated HTTPS proxy through `registerService`
- The proxy supports both HTTP requests and WebSocket upgrades
- Client certificate is extracted from the proxy TLS socket
- Certificate is validated against `allowedClients` whitelist (if configured)
- Spoofable identity headers are removed and replaced with the verified certificate CN
- OpenClaw performs final authorization through `gateway.auth.mode: "trusted-proxy"`
- `GET https://<host>:18443/mtls/status` is forwarded to OpenClaw's `auth: "gateway"` route; proxy-local runtime details are not exposed anonymously

## 🚀 Quick Start

### Prerequisites

- OpenClaw `>= 2026.7.1`
- Node.js `20+`
- TLS certificates (server cert/key and CA for client cert validation)

### Install

```bash
openclaw plugins install @partme.ai/openclaw-mtls
```

### Minimal Config

```json
{
  "gateway": {
    "bind": "loopback",
    "port": 18789,
    "trustedProxies": ["127.0.0.1", "::1"],
    "auth": {
      "mode": "trusted-proxy",
      "trustedProxy": {
        "allowLoopback": true,
        "userHeader": "x-forwarded-user",
        "allowUsers": ["trusted-client-1"]
      }
    }
  },
  "plugins": {
    "entries": {
      "mtls": {
        "enabled": true,
        "config": {
          "enabled": true,
          "tls": {
            "certFile": "/path/to/server-cert.pem",
            "keyFile": "/path/to/server-key.pem",
            "caFile": "/path/to/ca-cert.pem"
          },
          "proxy": {
            "listenPort": 18443,
            "upstreamHost": "127.0.0.1",
            "upstreamPort": 18789
          },
          "allowedClients": [{ "cn": "trusted-client-1" }]
        }
      }
    }
  }
}
```

## 🔐 Configuration

### Top-Level Fields

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Enable the mTLS proxy; missing certificates fail startup |
| `tls` | — | TLS server configuration |
| `proxy` | `:18443 → 127.0.0.1:18789` | Listener and upstream Gateway configuration |
| `protectedPaths` | `[{path:"/",match:"prefix"}]` | Paths requiring mTLS authentication |
| `allowedClients` | `[]` | Whitelist of allowed client certificates |
| `skipPaths` | See below | Paths to skip authentication |
| `passthrough` | `false` (fixed) | Legacy field; protected routes cannot be put into passthrough mode |
| `headerName` | `X-Client-Cert` | Header to pass cert info downstream |
| `headerCertField` | `subject` | Which cert field to use for header |

### TLS Configuration

| Field | Default | Description |
|-------|---------|-------------|
| `tls.enabled` | `true` | Enable TLS |
| `tls.certFile` | — | Server certificate file path |
| `tls.keyFile` | — | Server private key file path |
| `tls.caFile` | — | CA certificate for client cert validation |
| `tls.requestCert` | `true` (required) | Request client certificates at the TLS listener |
| `tls.rejectUnauthorized` | `true` (required) | Require CA verification before a certificate can become an identity |

### Path Rules

| Field | Description |
|-------|-------------|
| `path` | URL path to protect |
| `match` | `"exact"` or `"prefix"` matching |
| `allowUnauthenticated` | Allow unauthenticated access (for this path only) |

### Client Whitelist

Each entry in `allowedClients` can specify:

| Field | Description |
|-------|-------------|
| `cn` | Client certificate Common Name (CN) |
| `issuer` | Client certificate issuer |
| `fingerprint` | Client certificate SHA fingerprint |

## 🧪 Testing

```bash
# Unit tests
npm test

# Build
npm run build

# Type check
npm run typecheck
```

## 🤖 GitHub Actions

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push / PR to `main` | Install, typecheck, build, test |
| `release.yml` | Tag `v*` | Build, test, publish npm package |

## 📦 Publishing

```bash
npm version patch
git push origin main --follow-tags
```

## 📁 Project Structure

```
openclaw-mtls/
├── src/
│   ├── index.ts              # Plugin lifecycle and status route
│   ├── config.ts             # Fail-closed configuration validation
│   ├── policy.ts             # Certificate and path policy
│   ├── proxy-server.ts       # HTTPS + WebSocket reverse proxy
│   ├── shared/types.ts       # Type definitions
│   └── runtime/stats.ts      # Statistics tracking
├── test/
│   └── mtls.test.ts         # Unit tests
├── .github/workflows/
│   ├── ci.yml              # CI workflow
│   └── release.yml          # Release workflow
├── openclaw.plugin.json     # Plugin metadata & config schema
├── package.json
└── README.md / README.zh-CN.md
```

## 📚 OpenClaw Documentation

- [Building Plugins](https://docs.openclaw.ai/plugins/building-plugins)
- [Plugin Architecture](https://docs.openclaw.ai/plugins/architecture)
- [SDK Overview](https://docs.openclaw.ai/plugins/sdk-overview)

## ❓ FAQ

**What is the difference between TLS and mTLS?**

Standard TLS only verifies the server's certificate to the client. mTLS adds bidirectional verification — the client also presents a certificate that the server validates.

**How does the Gateway handle mTLS?**

The OpenClaw Gateway terminates TLS at the proxy/load balancer level. The mTLS plugin extracts client certificate information from the TLS socket and enforces authentication policies.

**How do I allow specific clients only?**

Use `allowedClients` with CN, issuer, or fingerprint. Multiple match criteria are ANDed together within a single entry.

**What happens when a client doesn't provide a certificate?**

Protected paths reject the request with 401. To expose a public endpoint, add an explicit `allowUnauthenticated` path rule or `skipPaths` entry; the global proxy never downgrades protected paths into passthrough mode.

## 📄 License

MIT
