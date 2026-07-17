/**
 * E2E report writer — JSON artifact with per-plugin status and service evidence.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_DIR, GATEWAY_HTTP, STATE_DIR } from "./utils.mjs";

const SECRET_KEY = /(token|secret|password|api[-_]?key|authorization)$/i;

/** Return a JSON-safe report copy with credential-bearing fields removed. */
export function sanitizeReport(value, key = "") {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitizeReport(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeReport(childValue, childKey),
      ]),
    );
  }
  return value;
}

/**
 * 写入两份报告：固定路径供 CI/人工快速读取，时间戳归档供逐插件验收追溯。
 * 固定路径允许覆盖；归档文件名包含毫秒时间、插件集合与随机 runId，不会因连续运行丢失证据。
 *
 * @param {Record<string, unknown>} report
 * @param {{ e2eDir?: string; now?: Date; runId?: string }} [options]
 */
export function writeReport(report, options = {}) {
  const e2eDir = options.e2eDir ?? E2E_DIR;
  const now = options.now ?? new Date();
  const runId = options.runId ?? randomUUID();
  const pluginSlug = Array.isArray(report.plugins) && report.plugins.length > 0
    ? report.plugins.map((id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "_")).join("+")
    : "unknown";
  const timestamp = now.toISOString().replaceAll(":", "-");
  const archiveDir = join(e2eDir, "reports");
  const archivePath = join(archiveDir, `${timestamp}-${pluginSlug}-${runId}.json`);
  const reportPath = join(e2eDir, "e2e-report.json");

  report.finishedAt = now.toISOString();
  report.runId = runId;
  report.archivePath = archivePath;
  const serialized = JSON.stringify(sanitizeReport(report), null, 2);
  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(reportPath, serialized);
  writeFileSync(archivePath, serialized, { flag: "wx" });
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
  if (report.archivePath) {
    console.log(`Archive: ${report.archivePath}`);
  }
  console.log(`Gateway: ${GATEWAY_HTTP}`);
}
