# Task 5 / O5 — plugin lifecycle ownership

## Scope and resource inventory

Implemented O5 against `docs/superpowers/specs/2026-09-29-openclaw-followup-optimization.md` and Task 5 of the paired plan, starting from reviewed O4 HEAD `8930f0e`. The five installed candidates ran under OpenClaw `2026.9.6` and Node `v24.18.0`. No branch switch or push was performed. CodeGraph was absent and was not initialized.

| Plugin | Per-registration owner and consumers | Stop/failure/race behavior |
| --- | --- | --- |
| OAuth2 | `register` closure owns proxy, start promise, generation and `/auth/oauth2/status` route view | Stop closes only its proxy; failed or late starts close their own listener; repeated stop is safe. |
| mTLS | `register` closure owns proxy, start promise, generation and `/mtls/status` running state | Same proxy cleanup and race guard. `runtime/stats.ts` request counters remain deliberately process-wide, so only running/proxy status is owner-specific. |
| Nacos | `register` closure owns health, Config/Naming/cluster services, start promise and generation; health/cluster routes read that closure | Partial starts stop created services; old stop cannot change B's health or cluster. Cluster `updatePeers` callbacks verify generation and client identity after stop/restart. |
| Tracing | `register` closure owns context, timer, init promise, generation and trace store; hook queue/backend and status routes receive that owner | Stop invalidates pending callbacks, drains hook operations before backend shutdown, and retains the existing shutdown timeout. The SQLite query journal remains a shared profile store; live spans/status are per registration. |
| Prometheus | `register` closure owns collectors, cache, runner, diagnostics, runtime observation and WS bridge; route/service/hook callbacks carry the same owner | Stop/failure revoke that owner's subscriptions and handles; late callbacks cannot repopulate stopped state. The observer/store/bridge use per-owner state, while existing process metrics and O6 interfaces/labels remain shared. |

No broad shared-store rewrite was made. The explicit shared state above is part of the existing process/profile contract and is not reported as an A/B registration status. OAuth2/mTLS trusted-proxy checks, Nacos degrade policy, Tracing shutdown timeout, and Prometheus Bearer auth, scrape limits and metric labels remain in force.

## RED → GREEN and local checks

- OAuth2 and mTLS A/B tests first reproduced A.stop closing B's proxy; per-register closures made both GREEN. The tests also cover failed start, repeated stop and stop racing an in-flight start.
- Nacos A/B health/cluster tests first reproduced cross-owner status changes. A separate RED `updatePeers` test reproduced a queued callback repopulating peers after stop/restart; generation and client guards made it GREEN. Failure/restart and late service starts are covered.
- Tracing A/B tests first showed B disabled and its active spans lost after A.stop. A concurrent-stop RED showed backend shutdown before a blocked hook export; owner store and hook drain made both GREEN.
- Prometheus A/B RED showed A.stop unsubscribing B's diagnostics; per-registration subscription/store/observer/bridge state made it GREEN. Tests cover failed subscription, stop during start and restart.
- Final `pnpm --dir extensions/<id> test`, `typecheck`, and `build` passed for all five. Results: OAuth2 18 pass / 1 preexisting Redis-dependent skip; mTLS 21/21; Nacos 129/129; Tracing 77/77; Prometheus 54/54. Tracing `check-bundle` passed. E2E install/evidence helper tests passed 7/7. The OAuth2 unit skip is not an installed E2E skip.

## Exact reviewed packages and installed evidence

The parent independently approved each exact tarball before the five consent pins were updated. Package identity is `@partme.ai/openclaw-<id>@2026.7.1`, with matching manifest IDs. The first Nacos and Tracing candidates were superseded after additional RED fixes; only the replacements below are counted. The package sources and executable dist were frozen before installed testing. `scripts/e2e/lib/install.mjs` changes only the five reviewed content-digest pins.

| Plugin | Reviewed tarball SHA-256 | Reviewed content digest | Final source fingerprint | Final installed report (under `scripts/e2e/reports/`) |
| --- | --- | --- | --- | --- |
| OAuth2 | `d078080c3b90228a11f33dc86e28b354fb82db6dd2ad216507e2facfca09afe2` | `75ee6101005307c46673332e336a722c8d72e01e25853e4fc68e810b221b83ec` | `1d06bcb2aefb8ab20ac9c563325f331e0e7b2138704f463b77469c1fc769cba2` | `2026-10-02T20-31-11.308Z-oauth2-1844e268-eb77-469b-84a3-416196005407.json` |
| mTLS | `9621ff9f000c3137895b92b181e482237139e919d9ca51bd77a1f67281801bc6` | `d8122a3932d2731cb793cbd578679950d8a2e9aabf407652eecd8daf49d7fb11` | `b5f0768149e429c1d423dbfcfd819e3dfc4b69f7fdd54b1e6e16f6c30048d32f` | `2026-10-02T20-32-06.087Z-mtls-6136b747-ca42-4e3a-949c-d54d846941c2.json` |
| Nacos | `bdd81765554a58d1aa88c95b8d897734f569f4751014873779572bb5c446f5f7` | `ce21e83e7488f1816c728fd1517154f0b58cbdfe7513d4cabbab42375949c80c` | `737497216a115d7ac1dc1a00e8b96a1ba9bd50db05d2393869cbf2a6b6029f60` | `2026-10-02T20-33-37.301Z-nacos-0dd7f2ec-20b7-49c0-b6f8-af74cdebcf45.json` |
| Tracing | `1e742fd725657d474d8d1fce5073797c9731755e90d0ae89eac1a0a87ad936de` | `b33281bf3f447bff998fe889a2c454b362f8dacbf3cb9cfe48bb6d560ca5c754` | `1578463521702a5946bffd73e86c42c51de1ec77232bd19031e747f169da1eaf` | `2026-10-02T20-35-32.577Z-tracing+mqtt-acf89c26-45c5-4a14-8626-02299e95912d.json` |
| Prometheus | `ac8133263b5037618d56f437f05577273507a419eb0d11821c00b38fa7d1e5f4` | `1a40b0023d43a74254b5e8b597c6b30bf240e57bcc530aa3f3b335791425f91a` | `cf4c383bc399b5acb47cc45c6c8ecc71a58b25cf6d7ac82c6c10f9d16f86c45a` | `2026-10-02T20-30-10.397Z-prometheus-73319b44-365c-4fe3-bf2b-82fb485b264e.json` |

All five installed adapter rows are PASS; `skipInstall=false`, `skipBrowser=false`, `skipCount=0`. `validateEvidence` returned `[]` for each final report against its saved candidate manifest, exact installed SHA, current package version and current source fingerprint. OAuth2 and mTLS ran in separate host-Gateway batches because both use trusted-proxy frontends. Tracing ran with MQTT to produce a real Agent Turn and OTLP export. Prometheus ran in a container Gateway.

The installed stop/restart assertions close the Gateway and OAuth2/mTLS-owned listener ports, then verify the new process has the original authorization behavior. OAuth2 rechecks anonymous 401/login 302; mTLS rechecks rogue 401/valid-client 200 and running status. Prometheus confirms a closed Gateway port, then an authorized `openclaw_up=1` scrape, one build-info HELP, unauthorized 401 and healthy collectors/RPC. Tracing confirms the closed Gateway port, then a healthy OTLP backend, zero active traces, retained journal trace and unauthorized 401. The restart row contains the fresh OpenClaw host baseline; host PIDs changed OAuth2 `31125→31725`, mTLS `37495→37911`, and Tracing's final report records its own pair. Prometheus's container mode records stop/recreate plus the new host baseline, but not a container ID. Nacos's installed fixture publishes subscribed config, observes the Gateway restart and re-registration, then checks invalid-config degradation and subsequent recovery; it does not independently probe a closed port during that automatic restart.

After the final batch, TCP probes found Gateway `19789`, OAuth2 `18081`, mTLS `18443` and MQTT `11883` closed. Unit tests cover timer, subscription, callback and late-write cleanup that an external port probe cannot inspect. These are disposable local-host results, not live-provider or production evidence. The global 27-plugin evidence gate remains for later convergence; only these five O5 reports were validated here.

The three preexisting modified browser logs were preserved and excluded from the commit. The repository's 4,000-token per-task guideline was exceeded by the required five-plugin installed test and artifact audit; this was surfaced to the parent.
