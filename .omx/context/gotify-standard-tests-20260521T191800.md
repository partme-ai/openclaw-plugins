# Gotify Standard Tests — Context Snapshot

**Timestamp:** 2026-05-21T19:18:00+08:00  
**Workspace:** `/Users/wandl/workspaces/workspace-partme-ai/openclaw-plugins/`

## Task

Finalize the shared standard test dataset, implement Gotify as the reference `ChannelAdapter`, and run L0–L3 automated verification with captured evidence.

## Outcome (target)

- `test-dataset.yaml` parses cleanly; fixture refs consistent
- `extensions/gotify/scripts/standard-test-adapter.ts` + `run-gotify-standard-tests.ts`
- `pnpm test` (unit) + `pnpm test:standard` (L0–L3) pass with report output
- `testing/README.md` documents Gotify reference implementation

## Constraints

- Do **not** commit unless explicitly requested
- Use e2e-user **APP** token for inbound send; **CLIENT** token for poll
- Skip outbound echo on inbound stream (adapter poll accepts agent replies)
- Gotify capabilities: no multimodal inbound → L7–L9 auto-skip
- Gateway at `localhost:18789`, Gotify at `localhost:8080`

## Touchpoints

| Path | Role |
|------|------|
| `testing/test-dataset.yaml` | 34 standard cases; fix YAML + fixture refs |
| `testing/scripts/run-standard-tests.ts` | Generic runner / `ChannelAdapter` interface |
| `testing/capabilities.gotify.yaml` | Capability flags for skip logic |
| `testing/fixtures/` | SVG images + audio WAV/OGG |
| `extensions/gotify/scripts/standard-test-adapter.ts` | **NEW** Gotify adapter |
| `extensions/gotify/scripts/run-gotify-standard-tests.ts` | **NEW** thin wrapper |
| `extensions/gotify/package.json` | Add `test:standard`, `yaml` dep |
| `testing/README.md` | Reference implementation docs |

## Tokens (test env)

- `GOTIFY_CLIENT_TOKEN=C7ErQjzzeoAXCKg`
- `GOTIFY_APP_TOKEN=AK-MvdcbyFOfBmQ` (e2e-user inbound)
