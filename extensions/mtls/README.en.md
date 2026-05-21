# OpenClaw mTLS

**OpenClaw plugin — mTLS (Mutual TLS) bidirectional certificate authentication**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--mtls-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)

[English](./README.md) | [简体中文](./README.zh-CN.md)

## 📖 Introduction

`@partme.ai/openclaw-mtls` is an OpenClaw security plugin that provides **mTLS (Mutual TLS)** bidirectional certificate-based authentication for the OpenClaw Gateway.

### What is mTLS?

mTLS (Mutual TLS) is a security mechanism where both the client and server authenticate each other using X.509 certificates. Unlike standard TLS where only the server presents a certificate, mTLS requires the client to present a valid certificate signed by a trusted Certificate Authority (CA).

### Core Capabilities

- **Bidirectional Authentication**: Both server and client present certificates for mutual verification
- **Client Certificate Validation**: Extract and verify client certificate CN, issuer, fingerprint
- **Whitelist Control**: Fine-grained access control via `allowedClients` (CN/issuer/fingerprint)
- **Path-Based Protection**: Configure which paths require mTLS authentication via `protectedPaths`
- **Passthrough Mode**: Optional `passthrough` mode allows unauthenticated requests when no certificate is provided
- **Certificate Info Propagation**: Pass client certificate information to downstream services via HTTP headers
- **OpenClaw Integration**: Follows OpenClaw's security plugin architecture

### Architecture

```
Client (with client cert)
    → HTTPS + mTLS
    → OpenClaw Gateway
    → mTLS Middleware (validates client cert)
    → Downstream handlers
```

### Lifecycle

- Plugin registers via `registerHttpRoute` when Gateway loads the plugin
- mTLS middleware intercepts HTTP requests on protected paths
- Client certificate is extracted from the TLS socket
- Certificate is validated against `allowedClients` whitelist (if configured)
- Authenticated context is attached to the request for downstream use
- Status endpoint available at `GET /mtls/status`

## 🚀 Quick Start

### Prerequisites

- OpenClaw `>= 2026.4.0`
- Node.js `20+`
- TLS certificates (server cert/key and CA for client cert validation)

### Install

```bash
openclaw plugins install @partme.ai/openclaw-mtls
```

### Minimal Config

```json
{
  "mtls": {
    "enabled": true,
    "tls": {
      "enabled": true,
      "certFile": "/path/to/server-cert.pem",
      "keyFile": "/path/to/server-key.pem",
      "caFile": "/path/to/ca-cert.pem",
      "requestCert": true,
      "rejectUnauthorized": true
    },
    "protectedPaths": [
      { "path": "/", "match": "prefix", "allowUnauthenticated": false }
    ],
    "allowedClients": [
      { "cn": "trusted-client-1" },
      { "cn": "trusted-client-2", "issuer": "My CA" }
    ],
    "skipPaths": ["/health", "/auth/status", "/mtls/status"],
    "passthrough": false,
    "headerName": "X-Client-Cert",
    "headerCertField": "subject"
  }
}
```

## 🔐 Configuration

### Top-Level Fields

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Enable/disable the mTLS plugin |
| `tls` | — | TLS server configuration |
| `protectedPaths` | `[{path:"/",match:"prefix"}]` | Paths requiring mTLS authentication |
| `allowedClients` | `[]` | Whitelist of allowed client certificates |
| `skipPaths` | See below | Paths to skip authentication |
| `passthrough` | `false` | Allow unauthenticated requests when no cert |
| `headerName` | `X-Client-Cert` | Header to pass cert info downstream |
| `headerCertField` | `subject` | Which cert field to use for header |

### TLS Configuration

| Field | Default | Description |
|-------|---------|-------------|
| `tls.enabled` | `true` | Enable TLS |
| `tls.certFile` | — | Server certificate file path |
| `tls.keyFile` | — | Server private key file path |
| `tls.caFile` | — | CA certificate for client cert validation |
| `tls.requestCert` | `true` | Request client certificate |
| `tls.rejectUnauthorized` | `true` | Reject clients without valid certificate |

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
│   ├── index.ts              # Plugin entry — registerHttpRoute middleware
│   ├── types.ts              # Type definitions
│   ├── stats.ts             # Statistics tracking
│   └── openclaw-sdk.d.ts   # OpenClaw type declarations
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

By default (`passthrough: false`), the request is rejected with 401. If `passthrough: true`, the request is allowed through but no `mtlsAuth` context is attached.

## 📄 License

MIT
