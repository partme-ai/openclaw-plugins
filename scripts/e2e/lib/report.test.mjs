import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sanitizeReport, writeReport } from "./report.mjs";

test("sanitizeReport redacts nested credentials without mutating evidence", () => {
  const report = {
    gotify: { appToken: "app", outboundAppToken: "outbound", client_token: "client", allowedAppId: 7 },
    config: { password: "secret", auth: { mode: "none" } },
  };

  assert.deepEqual(sanitizeReport(report), {
    gotify: { appToken: "[REDACTED]", outboundAppToken: "[REDACTED]", client_token: "[REDACTED]", allowedAppId: 7 },
    config: { password: "[REDACTED]", auth: { mode: "none" } },
  });
  assert.equal(report.gotify.appToken, "app");
});

test("writeReport keeps latest and creates a non-overwriting per-run archive", () => {
  const e2eDir = mkdtempSync(join(tmpdir(), "openclaw-e2e-report-"));
  const now = new Date("2026-07-17T06:45:00.123Z");
  const first = { plugins: ["memory"], config: { token: "secret" } };
  const second = { plugins: ["memory"], config: { token: "new-secret" } };

  const latestPath = writeReport(first, { e2eDir, now, runId: "run-1" });
  writeReport(second, { e2eDir, now, runId: "run-2" });

  assert.equal(latestPath, join(e2eDir, "e2e-report.json"));
  assert.notEqual(first.archivePath, second.archivePath);
  assert.equal(JSON.parse(readFileSync(first.archivePath, "utf8")).config.token, "[REDACTED]");
  assert.equal(JSON.parse(readFileSync(second.archivePath, "utf8")).runId, "run-2");
  assert.equal(JSON.parse(readFileSync(latestPath, "utf8")).runId, "run-2");
});
