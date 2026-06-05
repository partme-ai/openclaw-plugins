# Context: Plugin Structure Unification (Ralph)

## Task
From Phase 0 (checker Profile split) through full migration: unify all openclaw-plugins extensions to directory standard.

## Desired outcome
- check-plugin-structure.mjs supports Channel Base / Channel Extended / Capability / Infra-SDK profiles
- All 28 audited plugins migrated or correctly exempted
- Tier A plugins: 0 error 0 warn under their profile
- Channel debt: bridge, wechat, wechat-ipad, prometheus migrated
- Capability/Infra: nacos, mtls, oauth2, memory, openmem, tracing, cluster, knowledge, router profiled
- All typecheck + test pass; commits on feature branch

## Hard constraint
**ONLY** move files, rename files, adjust imports/dependencies. **NO logic changes.**

## Known facts
- Standard: doc/OpenClaw-Plugin-Structure-Standard.md v1.0
- Reference: extensions/_template (Base), wecom-kf (Extended)
- BASE_STRICT_PLUGINS: 12 messaging + wecom/wecom-kf extended
- Tier A pass strict-base: amap, douyin, gotify, meituan, mqtt, rabbitmq, redis-stream, rednode, rocketmq, stomp, web-mqtt, web-stomp, wecom-kf
- wecom: 1 compat warn; bridge/wechat/prometheus/router fail strict-base

## Touchpoints
- scripts/check-plugin-structure.mjs
- doc/OpenClaw-Plugin-Structure-Standard.md
- extensions/*/
- .github/workflows/ci.yml

## Phases
0. Checker Profile split
1. compat manifest + plugin pnpm-lock cleanup (Tier A)
2. Channel migration: wechat-ipad, wechat, bridge, prometheus
3. Capability/Infra: nacos, mtls, oauth2, memory, openmem, tracing, cluster, knowledge, router
4. CI + full workspace verify + commit
