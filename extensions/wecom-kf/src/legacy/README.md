# wecom-kf Legacy Boundary

This directory contains disabled-by-default WeCom Bot/Agent compatibility code.

- Owner: PartMe OpenClaw plugin maintainers
- Runtime switch: `channels.wecom-kf.legacyWecomCsEnabled`
- Default state: disabled
- Deletion window: remove after the KF-only runtime has replaced all legacy Bot/Agent callback usage

New KF runtime code must not be added here. Move new behavior into `webhook/`, `dispatch/`, `outbound/`, `tools/`, or `state/`.
