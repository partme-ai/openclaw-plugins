# Task 3 / O3 implementation record

Base: 357bb9e871ad532a9401c42de619f7756f1cebc7. Status: implemented, locally committed and verified; parent independent code/spec review pending.

Commit: `b5fc071c0315c41f99e353c8b01dbd06cfc962ec` — `feat: preserve structured replies through wire routing`. No push or branch creation/switch.

SDD: Brownfield; existing Superpowers spec/plan is the sole source. Scope O3 only. Root has no .codegraph; did not initialize. Existing browser MQTT/STOMP/WebSocket logs preserved.

Budget: Required CLAUDE, brief, spec/plan and immediate source reads exceeded the CLAUDE 4,000 token per-task budget. Reported immediately to parent; parent acknowledged continuation with full acceptance scope. No acceptance removed for token saving.

Skills: executing-plans and test-driven-development read; final independent review belongs to parent.

RED: `pnpm --dir extensions/message-sdk exec vitest run src/dispatch/structured-wire.test.ts` produced 8 failed / 1 passed, 0 skips. Legacy byte fixture already passes. New schema/order/authorization/version failures demonstrate missing behavior. Full output: task-3-red-sdk.log.

Initial scope expansion requests were all approved before implementation; see approved expansion summary below.

## Implementation and tests (checkpoint)

Implemented SDK explicit versioned codec/parser, ordered parts, strict media URL shape, host allowlist plus public-network host media loader with 8 MiB/file cap; 8 media/message and 1 MiB aggregate content limit. Reply bridge propagates schema payload or native text/media and stable generated identity; native original wire IDs retained. Router opt-in parsing, target declaration plus actual adapter method preflight, ordered sendPayload or sendText/sendMedia, stable route id and ordinals across retry, persisted structured payload, explicit text loss audit. Old Outbox schema remains readable. MQTT opts into structured output via its existing payload configuration.

Approved expansions are recorded in parent chat: SDK core/export/parse/dispatch; Router dependency/bundle/manifest/durable fields; MQTT config/types/manifest/inbound; E2E exact four-plugin isolation exception, WeCom provider multipart upload fixture, Router fixture. No WeCom production change.

RED→GREEN logs: `task-3-red-sdk.log` 8 failures, `task-3-red-bridge.log` 2 failures, `task-3-red-router.log` 2 failures, `task-3-red-mqtt.log` 1 failure, `task-3-red-sendmedia.log` 1 failure, `task-3-red-audit.log` 1 failure, `task-3-red-limits.log` 1 failure, `task-3-red-registry.log` 1 failure. Existing legacy golden passed before changes.

Current evidence: SDK `pnpm test` 534/534 and typecheck pass; Router 69/69 after mandatory fallback audit; MQTT with `TEST_REDIS_URL=redis://127.0.0.1:16389 pnpm --dir extensions/mqtt test` 93/93 (0 skips). Earlier no-Redis run had 1 conditional skip, superseded by isolated Redis run. `pnpm --dir extensions/message-sdk verify:consumers`: 92 source files, 15 subpaths, 149 named symbols pass. SDK/Router/MQTT package builds passed. Three preexisting browser logs are untouched by edits and excluded from commit.

## Installation attempts

- Four-plugin fixture initially rejected existing WeCom isolation. Parent explicitly approved exact set mqtt/router/wecom/gotify only with OPENCLAW_E2E_STRUCTURED_WIRE=1; a RED→GREEN node:test verifies all other isolation remains.
- Gotify default 18080 is occupied by another service. Used dedicated 18083 and explicit GOTIFY_URL; did not touch that service.
- Full runner reached WeCom candidate archive and refused changed consent artifact. No pin changed by implementer pending parent independent review.
- Candidate review details are in `/tmp/o3-reviewed-candidates/review.json`. MQTT and Router source maps match all 55 and 105 source entries, respectively. WeCom actual builder is tsup with sourcemap=false (CLAUDE's tsc statement is stale); Gotify uses tsc. WeCom runner archive `59a71b34-8ae3-4431-9e4d-32271612e37e-wecom.tgz` equals separately packed reviewed candidate SHA.

Scoped command (not yet passed):

```sh
OPENCLAW_E2E_STRUCTURED_WIRE=1 OPENCLAW_E2E_HOST_GATEWAY=1 \
OPENCLAW_E2E_STATE_DIR=/tmp/openclaw-o3-e2e OPENCLAW_STATE_DIR=/tmp/openclaw-o3-e2e \
OPENCLAW_CONFIG_PATH=/tmp/openclaw-o3-e2e/openclaw.json \
E2E_GOTIFY_PORT=18083 GOTIFY_URL=http://127.0.0.1:18083 \
TEST_REDIS_URL=redis://127.0.0.1:16389 \
node scripts/e2e/run-e2e.mjs --plugins mqtt,router,wecom,gotify
```

Ruling: public immutable HTTPS image needed because the real WeCom media loader forbids private-network fetches and has no authorization-buffer input. Fixture uses repository 357bb9e approve.png, exact expected SHA. No private-network bypass, TLS bypass or production-policy expansion. Requires public download network.

Known boundary: WeCom catches internal media errors and emits a text link while returning success. Router cannot identify this downgrade from its current public result. E2E must prove actual upload SHA and image-message order; Router success alone is insufficient. At-least-once retries may duplicate completed prefix parts. Reply/thread metadata reaches public adapter context; actual provider support is channel-specific. O3 does not establish full 27-plugin gate.

Packaging checkpoint: `node --input-type=module -e 'await import("./extensions/router/dist/index.js")'` failed with `Dynamic require of "assert" is not supported`. Root SDK barrel imported an unused Undici CJS side effect into Router. Router candidate c39aeeca is withdrawn; requested an isolated SDK structured-wire export/bundle entry and corresponding Router import. Unit green is not considered package-runtime acceptance.

## Subsequent verified checkpoints (supersede earlier pending notes)

- Fixed native Node ESM import through the SDK `./structured-wire` subpath; package import RED→GREEN 1/1. All legacy exports remain, `verify:consumers` now validates 16 subpaths, 92 source files, 149 symbols; `verify:package` validates 24 entrypoints. Latest SDK full suite is 535/535, Router 69/69, MQTT 93/93 with Redis, all zero skips.
- Parent independently reviewed and approved exact candidate archive/content hashes. Router replacement has 7 source-map entries matching current source. MQTT 55 entries. No consent bypass. Approved content digests are recorded in `scripts/e2e/lib/install.mjs` and `/tmp/o3-reviewed-candidates/review.json`.
- Original single-plugin WeCom installed E2E PASS, zero skips: `scripts/e2e/reports/2026-10-02T18-14-20.839Z-wecom-64aab0f0-aef1-4510-bfcc-766fb941e847.json`.
- First complete four-plugin installation run produced MQTT/Gotify PASS, Router/WeCom FAIL, zero skips: `scripts/e2e/reports/2026-10-02T18-19-41.736Z-mqtt+router+wecom+gotify-9921c7e6-489a-46f0-b46c-82f273baab5b.json`. Router media failed before send because local DNS resolves raw.githubusercontent.com to special-use 198.18.1.20, correctly rejected by the installed host SSRF guard. Full failed Gateway log preserved as `task-3-dns-rejected-gateway.log`. WeCom's preexisting absolute reply-count assertion was unsuitable after Router messages; changed to callback-relative count plus actual recipient check, retaining completion and restart dedup checks.
- Parent independently verified public GitHub A record 185.199.108.133, TLS/SNI direct fetch and fixed image SHA, then authorized only the O3 local Gateway child DNS preload. Exact hostname only; callback and promise DNS APIs covered, `syncBuiltinESMExports` updates native ESM consumers. Both OPENCLAW_E2E_STRUCTURED_WIRE=1 and OPENCLAW_E2E_STRUCTURED_DNS_PIN=1 required; no production/system DNS or SSRF change. Tests prove disabled mode retains original result and non-target names preserve callback overload/arguments. RED 2 failures for missing module; extra overload RED 1 failure; GREEN DNS 2/2. Relevant E2E harness regressions 15/15, zero skips (task-3-harness-final.log).

## Reviewed final candidates

- mqtt: `/tmp/o3-reviewed-candidates/mqtt/partme.ai-openclaw-mqtt-2026.7.1.tgz`; tgz SHA256 `1c1f51a1cd70b60d4fdc60f6e461e86326b49e004f61f5f4c0d8b730ae7d1488`; reviewedArtifactDigest `d9de7761611d413b190e93551d4e1898f8ae8be13f8f05c5d67df6e404e6fd18`.
- router: `/tmp/o3-reviewed-candidates/router/partme.ai-openclaw-router-2026.7.1.tgz`; tgz SHA256 `ba9526ff7c947d6f5c62b5f9e0bcfa64f9fd49dc8cb53e4751491c072849ef49`; reviewedArtifactDigest `cb0227659f7ccf5fea203e6108940e4a829f30e3bd740ba4c6f856184afe22f8`.
- wecom: `/tmp/o3-reviewed-candidates/wecom/partme.ai-wecom-2026.7.1.tgz`; tgz SHA256 `53a1c138bedd8041a4de574a8a605e46c82a1782428075825e3184f225bfe332`; reviewedArtifactDigest `5f931beaa49752e861897de417cc80dca79da3233c6cd0a0b194d1553f9a939a`.
- gotify: `/tmp/o3-reviewed-candidates/gotify/partme.ai-openclaw-gotify-2026.7.1.tgz`; tgz SHA256 `61383c6f92cbd7169f2d958fc8d157f72c7dfddf6666bd156624dd7e3634584f`; reviewedArtifactDigest `db887c22e60191a7d816b18207f874ad16095a17071b38ac4e46ed4af2c6a3c1`.

Parent independent audit verified safe archive entries, package/manifest equivalence except legitimate pnpm pack transforms, dist byte consistency, and mapped source matches (MQTT 55, Router 7). WeCom has no source map in its actual build, so no source-map claim is made. Router's former c39a/244e candidate was withdrawn and never used as final evidence.

## Final reproducible verification commands

```sh
pnpm --dir extensions/message-sdk test
pnpm --dir extensions/message-sdk typecheck
pnpm --dir extensions/message-sdk build
pnpm --dir extensions/message-sdk verify:consumers
pnpm --dir extensions/message-sdk verify:package
pnpm --dir extensions/router test
pnpm --dir extensions/router typecheck
pnpm --dir extensions/router build
node --test extensions/router/scripts/package-import.test.mjs
TEST_REDIS_URL=redis://127.0.0.1:16389 pnpm --dir extensions/mqtt test
pnpm --dir extensions/mqtt typecheck
pnpm --dir extensions/mqtt build
node --test scripts/e2e/helpers/structured-wire-dns.test.mjs scripts/e2e/lib/registry.structured-wire.test.mjs scripts/e2e/lib/install.test.mjs scripts/e2e/lib/gateway.test.mjs
```

SDK consumer/package checks were repeated after the final narrow export; full SDK 535/535, Router 69/69, MQTT 93/93, native import 1/1, harness 15/15. Unit/type/package builds also run inside candidate installation. An earlier verify:package attempt raced the E2E build's dist clean; rerunning after build completion passed all 24 entrypoints. No failed or skipped run is counted as the final passing gate.

Final four-plugin command is the earlier scoped command plus `OPENCLAW_E2E_STRUCTURED_DNS_PIN=1`. Original standalone WeCom command (both O3 flags unset):

```sh
OPENCLAW_E2E_HOST_GATEWAY=1 OPENCLAW_E2E_STATE_DIR=/tmp/openclaw-o3-wecom-e2e \
OPENCLAW_STATE_DIR=/tmp/openclaw-o3-wecom-e2e OPENCLAW_CONFIG_PATH=/tmp/openclaw-o3-wecom-e2e/openclaw.json \
node scripts/e2e/run-e2e.mjs --plugins wecom
```

Final standalone report: `scripts/e2e/reports/2026-10-02T18-30-49.175Z-wecom-d6b24b6b-10f5-4b81-b9f2-28e8bbf6b598.json`, PASS, skipCount=0. `readCandidateManifest` plus `validateEvidence` with current source fingerprint, current package version, OpenClaw 2026.9.6 and Node v24.18.0 returned `[]`.

The intermediate combination report `ce75defa-690c-4b56-8dee-740f0ee34c67` had actual four-plugin PASS and correct image bytes, but is NOT final evidence: run-e2e snapshots fingerprints before building, and the DNS callback overload fix occurred after that snapshot. It was correctly rejected as stale by independent validation. Final rerun freezes all executable inputs for the full run.

## Final installed evidence and completion

- Frozen-source report: `scripts/e2e/reports/2026-10-02T18-35-12.157Z-mqtt+router+wecom+gotify-d455f84f-51a7-4cf9-b3be-b774a06de51e.json`.
- MQTT, Router, WeCom, Gotify: all PASS; skipCount=0, skipInstall=false, skipBrowser=false. Host OpenClaw 2026.9.6, Node v24.18.0, installed candidate package version 2026.7.1.
- Candidate manifest: `scripts/e2e/reports/candidates/0bfd31a3-28b8-42c6-a92a-283d0bf14088.json`. Exact installed tarball SHAs match the independently approved candidates above.
- Actual ingress `messageId=o3-1790966085881`, `deliveryId=o3-1790966085881-delivery`; WeCom mock received text→image→text, upload 198113 bytes, SHA256 `2e482e7c603d87edd0411414466f0f84d02c5055741a5a507b54f54a9c026851`. The assertion links image media_id to the uploaded byte hash; text-link fallback fails the test.
- `readCandidateManifest(report.candidateManifest)` verifies archived SHA; `validateEvidence` against current four `sourceFingerprint(id)` values, current 2026.7.1 package versions, host 2026.9.6 and Node v24.18.0 returned `[]`. Saved result: `task-3-final-evidence-validation.json`. The report's HEAD remains the precommit baseline because execution preceded commit; its verified fingerprints bind the exact final code contents.
- Full run console: `task-3-e2e-final.log`; standalone console: `task-3-wecom-final-e2e.log`. Other RED/target/regression logs are adjacent in this task directory.
- Final git status contains only the original three browser log modifications; none are in the 42-file commit. Dedicated test Redis 127.0.0.1:16389 shut down with NOSAVE. E2E Gateway and its compose services cleaned up by runner. No unrelated service was stopped.

### Acceptance boundary

O3 implementation and requested target/regression/installed acceptance are delivered. Existing envelope/legacy/plain defaults and golden bytes retained; explicit structured format, authorization, capability preflight, auditing and stable retry identity are covered. Independent code/spec review remains with parent; no full 27-plugin release-readiness claim is made.

Remaining limitations: at-least-once retry can repeat sent prefix parts; WeCom's internal successful text-link downgrade cannot be distinguished from media success by Router's public adapter result; provider-specific reply/thread support and arbitrary wire ID transport are not universally guaranteed. Unit tests verify wire identity/reply/thread roundtrip and adapter context; installed mock verifies real positive-path upload bytes/order, not a live external WeCom account. Media download requires public HTTPS and uses the explicitly approved Gateway-only DNS pin in this environment; without it, the existing special-use DNS result is correctly denied by the unchanged host SSRF policy. No private-network/TLS bypass was introduced.

## Independent review repair: empty text fallback

Independent review found that media-only structured input with explicit text fallback called sendText with an empty string and incorrectly settled delivered. Added RED cases for no text parts and whitespace-only text. Both fail on an actual text adapter call before the fix (`task-3-red-empty-fallback.log`). Minimal production fix: `resolveChannelSend` rejects mediaFallback=text with empty trimmed content before loading/calling an adapter; existing dispatcher retries, then records DLQ and failed audit. Tests assert adapter untouched, delivered=0, deadLetters=1, failure reason and no delivered audit. Mixed text/media fallback remains covered and passing.

Router regression 71/71 (5 files), typecheck/build PASS, native ESM package import 1/1. Logs: `task-3-empty-fallback-green.log`, `task-3-fallback-build.log`. New Router candidate `/tmp/o3-fallback-review/router/partme.ai-openclaw-router-2026.7.1.tgz`, SHA256 `49f71f10b3af5ad377238a4997aec06275a993abc37fd03d85a669010988e9dd`, content digest `8aede03cac28b2218ecdb97295cb9203932286a6b750f990827c7c261919ce58`; 7 source-map entries match, manifest/capability unchanged. Submitted for parent independent audit before any consent pin update. Earlier d455f84f evidence is now stale for repaired Router until final rerun.

Parent independently approved the repaired Router exact SHA/content digest after checking safe archive entries, unchanged manifest/package (legitimate pnpm pack transforms excepted), both dist files and 7 source-map entries. Updated only Router consent pin to `8aede03cac28b2218ecdb97295cb9203932286a6b750f990827c7c261919ce58`. Install regression 3/3. Executable inputs frozen before launching the final repaired four-plugin run; no source changes during installation/testing.

### Repair final result (supersedes pre-review final evidence)

Repair commit: `83f373b9d5aee79db680fa63620f71d6a53bd168` (`fix: reject empty structured text fallback`), 4 files, 28 insertions/2 deletions. Main implementation remains `b5fc071c0315c41f99e353c8b01dbd06cfc962ec`. No push/branch switch.

Frozen repaired-source installed report: `scripts/e2e/reports/2026-10-02T18-47-56.839Z-mqtt+router+wecom+gotify-5ef977b6-66d1-4519-9283-a97543707860.json`; all four plugins PASS, zero skipped. Candidate manifest `scripts/e2e/reports/candidates/4fb88b1c-629e-4e0d-9bc4-c58e3487d363.json`; Router installed SHA `49f71f10b3af5ad377238a4997aec06275a993abc37fd03d85a669010988e9dd` matches exact independently approved repair candidate. Host remains OpenClaw 2026.9.6/Node v24.18.0. `readCandidateManifest` + current four source fingerprints + `validateEvidence` returns `[]`, saved in `task-3-fallback-evidence-validation.json`; parent independently confirmed the same result.

Actual repaired installed media proof: MQTT messageId `o3-1790966849197`, deliveryId `o3-1790966849197-delivery`; WeCom uploaded 198113 bytes with pinned SHA `2e482e7c603d87edd0411414466f0f84d02c5055741a5a507b54f54a9c026851`, then correct text→image→text sequence. Console `task-3-fallback-e2e-final.log`. No fixtures or assertions were weakened. Empty fallback RED→GREEN is additionally verified by Router71/71, typecheck/build/import1/1; install regression3/3.

Final worktree still contains only the original browser MQTT/STOMP/WebSocket log modifications, excluded from both commits. Dedicated Redis 16389 was shut down NOSAVE after final run. Original independent-review FAIL and its RED evidence are retained above. The original reviewer rechecked the repaired behavior and concluded Spec PASS / Quality APPROVE with no remaining blocker. The reviewer independently replayed media-only fallback against the current dist and temporary Outbox: zero sendText calls, zero delivered, one DLQ and failure audit. Targeted Router 28/28, second full Router 71/71, typecheck and native ESM import passed. The first full Router rerun encountered an intermittent lease-owner JSON read; it passed on the second run with no persistence-layer change. All previously stated at-least-once, WeCom internal-downgrade, public-network/DNS-fixture and provider-metadata limitations still apply.
