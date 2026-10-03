# U3 real Control UI grant fixture

Run `node scripts/u3-auth-grant-e2e.mjs` only while the shared `scripts/e2e/run-e2e.mjs` runner is idle. This starts OpenClaw 2026.9.6 with a separate temporary profile and loopback port. It does not install or change any of the 27 production plugin packages.

The fixture owns `/u3-auth-grant-fixture` and registers a matching Control UI tab. The runner also loads Router and Tracing with exact, read-only `/router/status` and `/tracing/status` Control UI tabs. It authenticates to `/control-ui-config.json`, keeps the unmodified server-issued Cookies, proves each same-plugin status GET succeeds while POST is denied, and checks cross-plugin access and Router replay are denied without side effects. It then waits until the Cookies' actual five-minute expiry and retries GET against the same Gateway process. A test-only `--fixture-only` mode omits Router and Tracing.

Each run writes a redacted result under `reports/`. On failure it preserves the temporary profile and Gateway log for diagnosis. This checks an installed Gateway's read-only and expiry boundary, including same-plugin Router and Tracing grants and cross-plugin isolation. Fixture responses contain no production data.
