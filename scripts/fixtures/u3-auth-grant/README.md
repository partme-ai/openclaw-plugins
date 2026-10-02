# U3 real Control UI grant fixture

Run `node scripts/u3-auth-grant-e2e.mjs` only while the shared `scripts/e2e/run-e2e.mjs` runner is idle. This starts OpenClaw 2026.9.6 with a separate temporary profile and loopback port. It does not install or change any of the 27 production plugin packages.

The fixture owns `/u3-auth-grant-fixture` and registers a matching Control UI tab. The runner authenticates to `/control-ui-config.json`, keeps the unmodified server-issued Cookie, proves its own GET succeeds while its POST is denied without entering the mutation handler, and checks the same Cookie cannot read Router's DLQ or replay it. It then waits until the Cookie's actual five-minute expiry and retries GET against the same Gateway process. A test-only `--fixture-only` mode omits Router.

Each run writes a redacted result under `reports/`. On failure it preserves the temporary profile and Gateway log for diagnosis. This checks an installed Gateway's read-only and expiry boundary, including cross-plugin isolation. Router and Tracing do not currently register Control UI tabs, so this is not evidence of a same-plugin grant for either one. Fixture responses contain no production data.
