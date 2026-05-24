/**
 * E2E report writer — JSON artifact with per-plugin status and service evidence.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_DIR, GATEWAY_HTTP, STATE_DIR } from "./utils.mjs";

/**
 * @param {Record<string, unknown>} report
 */
export function writeReport(report) {
  report.finishedAt = new Date().toISOString();
  const reportPath = join(E2E_DIR, "e2e-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}

/**
 * @param {Record<string, unknown>} partial
 */
export function baseReport(partial = {}) {
  return {
    startedAt: new Date().toISOString(),
    stateDir: STATE_DIR,
    gatewayUrl: GATEWAY_HTTP,
    ...partial,
  };
}

/**
 * @param {ReturnType<typeof baseReport>} report
 */
export function printSummary(report) {
  console.log("\n=== E2E Results ===");
  if (Array.isArray(report.e2e)) {
    for (const r of report.e2e) {
      console.log(`${String(r.plugin).padEnd(12)} ${String(r.result).padEnd(6)} ${r.method ?? ""} ${r.blocker ?? ""}`);
    }
  }
  if (Array.isArray(report.browser) && report.browser.length) {
    console.log("\nBrowser:");
    for (const r of report.browser) {
      console.log(`${String(r.plugin).padEnd(12)} ${String(r.result).padEnd(6)} ${r.blocker ?? r.evidence ?? ""}`);
    }
  }
  if (report.reportPath) {
    console.log(`\nReport: ${report.reportPath}`);
  }
  console.log(`Gateway: ${GATEWAY_HTTP}`);
}
