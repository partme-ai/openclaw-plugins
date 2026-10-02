# Task 4 / O4 — Bridge channel availability

## Scope and decision

Implemented O4 against `docs/superpowers/specs/2026-09-29-openclaw-followup-optimization.md` and Task 4 of the paired plan. The source of truth for host shape is OpenClaw tag `v2026.9.6` at `ce5bbdc244ee937246cc1700d1b224d020c3b599`, not the moving 2026.9.7 research checkout. The installed host was separately verified as OpenClaw `2026.9.6` on Node `v24.18.0`.

The host tag exposes `plugins.list` (`src/gateway/server-methods/plugins.ts:101+`) with catalog `installed/enabled` and `runtime.state`, and `channels.status` (`src/gateway/server-methods/channels.ts:336+`) with `channelAccounts` and `partial`. `src/channels/plugins/types.core.ts:147+` defines account `enabled/running/connected/lifecycle`; `src/gateway/methods/core-descriptors.ts:42,405` assigns both reads `operator.read`. `src/gateway/server-plugins.ts:84+` prevents an external Bridge plugin from making privileged `runtime.gateway.request` calls. Bridge therefore exports an explicit adapter that consumes responses supplied by an authorized host caller; it does not elevate its own scope or infer state from Bridge config.

## Implementation

- `resolveChannelAvailability(meta, runtimeFacts)` returns `known/installed/enabled/ready` plus `unavailableFacts` for facts missing from the host. Static catalog membership only establishes `known`; unknown IDs remain false even if a caller supplies positive facts. Known false values stay separate from unavailable values.
- `adaptGatewayChannelFacts(meta, pluginsList, channelsStatus)` reads canonical catalog metadata before using the host plugin ID, preventing caller metadata from borrowing another plugin's status. Missing and partial snapshots fail closed. MQTT uses its host-reported running listener; other channels require explicit connected or ready lifecycle evidence. Disabled, unloaded and service-failed states cannot become ready.
- The catalog now identifies 19 bundled 2026.9.6 channels, six repository channels and two external connectors. QQ Bot uses downloadable `@tencent-connect/openclaw-qqbot`, plugin ID `openclaw-qqbot`, channel ID `qqbot`. All 19 bundled IDs were checked against their manifests at the pinned tag. The static capability matrix remains a format/limit approximation, and the existing O2 context budget/cancel behavior remains intact.
- Bridge entry wording, manifest description, and the English/Chinese README sections now distinguish catalog recognition from live readiness.

## RED → GREEN and local checks

1. Initial availability tests: 4 failures for absent resolver/adapter and QQ mapping, then 16/16 passed.
2. Cloned metadata and partial status: 2 failures, then 17/17 passed.
3. Spoofed `hostPluginId`: 1 failure (`installed` incorrectly true), then 18/18 passed after canonical lookup.
4. Final `pnpm --dir extensions/bridge test`: 9 files, 164/164 tests passed; `pnpm --dir extensions/bridge typecheck` and `pnpm --dir extensions/bridge build` passed; `node --check scripts/e2e/plugins/bridge.mjs` passed. The installed runner also ran MQTT tests (92 passed, 1 skipped in its own suite).

## Exact candidate and installed evidence

- Reviewed packed Bridge archive: `scripts/e2e/reports/candidates/bdf7744f-7571-44c9-bf22-fcc0c842532c-bridge.tgz`, SHA-256 `ec73d8a2bbd167df3431ccc86f34114544cb77b71bd43612439a35a404343138`.
- Archive has 14 safe entries. Package remains `@partme.ai/openclaw-bridge@2026.7.1`; manifest ID remains `bridge`, with no capability declaration. Six dist files match the worktree byte-for-byte; all 11 bundled source-map entries match current source. The exact extracted-content consent digest changed from `f119e5bec01ad15dffef67f20d946693107c2cd69d70412fcad9ffe572c41cab` to `6025a952f546732bd6a14bd2da01c67404aaf95ccc0764d6ff62147db034021c`. Only the Bridge pin in `scripts/e2e/lib/install.mjs` changed; no trust logic or other pin changed.
- Final candidate manifest: `scripts/e2e/reports/candidates/bdf7744f-7571-44c9-bf22-fcc0c842532c.json`. Final installed report: `scripts/e2e/reports/2026-10-02T19-24-08.917Z-bridge+mqtt-62d477da-b303-49fe-b789-08b33cba0d8b.json`. Source fingerprints: Bridge `e3f6ca1f1b725cfa78fa3286b677add5b68ed8398c1437bbfc3bba088a75f0b9`; MQTT `86662cb7535abe84aa2e05b04ef92680fe442047f9716b5d7f941651018bfc94`.
- `node scripts/e2e/run-e2e.mjs --plugins bridge,mqtt` exited 0, with one PASS each for Bridge and MQTT, no install/browser skip. Its installed Bridge adapter preserved the O2 budget/provenance and cancellation assertions (345 UTF-8 bytes), then observed MQTT from live `plugins.list`/`channels.status` as installed/enabled/ready, invoked `channels.stop` on the disposable Gateway and observed installed/enabled/not-ready, invoked `channels.start` in `finally`, then observed installed/enabled/ready again. The real MQTT inbound → Agent Turn → reply → inbound/outbound mirror and no-loop assertions also passed. The stop/start result is Gateway lifecycle evidence; it does not prove a separate physical broker was disconnected.
- `validateEvidence` on that exact report, manifest, current Bridge/MQTT source fingerprints and current package versions returned `[]` separately for Bridge and MQTT. The global `node scripts/check-e2e-evidence.mjs` still exits 1 for 25 **other** plugins with stale or failing prior evidence; it reports no Bridge or MQTT issue. O4 cannot be used to claim all 27 runtime plugins are current.

## Boundaries

Other IM platforms have only static catalog/adapter coverage here; they need actual account, permission, network and platform-specific runtime acceptance. An external caller must provide authorized, same-Gateway status snapshots; Bridge does not poll them itself. No npm publication, branch switch or push was performed. Three preexisting `scripts/e2e/.browser-{mqtt,stomp,web-socket}.log` modifications were left untouched and excluded from the O4 commit. The repository `CLAUDE.md` 4,000-token per-task budget was exceeded by the required installed E2E and exact artifact audit; this was reported to the parent agent before implementation.
