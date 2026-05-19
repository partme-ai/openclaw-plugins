/**
 * Cron 指标采集器
 *
 * 数据来源：
 * - Gateway `cron.status` RPC — 调度器状态
 * - Gateway `cron.list` RPC — 任务列表
 *
 * 从真实数据中提取：
 * - 调度器是否启用
 * - 注册的 Cron 任务数
 * - 启用 / 禁用任务分布
 * - 下次唤醒时间
 */

import type { MetricCollector, MetricDefinition, MetricSample, CronStatus, CronJob } from "../types.js";
import { rpcCall } from "../ws-bridge.js";
import { sanitizeLabel } from "../utils.js";

const PREFIX = "openclaw_cron";
const CRON_LIST_PARAMS = {
  includeDisabled: true,
  limit: 50,
  offset: 0,
  enabled: "all",
  sortBy: "nextRunAtMs",
  sortDir: "asc",
} as const;

/**
 * Cron 采集器
 * 调用 cron.status 和 cron.list RPC
 */
export class CronCollector implements MetricCollector {
  name = "cron";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_scheduler_enabled`, help: "Cron scheduler enabled (1=yes, 0=no)", type: "gauge" },
    { name: `${PREFIX}_total`, help: "Total registered cron jobs", type: "gauge" },
    { name: `${PREFIX}_running`, help: "Cron jobs currently running", type: "gauge" },
    { name: `${PREFIX}_overdue_seconds`, help: "Cron job overdue seconds (>0 means delayed)", type: "gauge", labels: ["job"] },
    { name: `${PREFIX}_last_duration_seconds`, help: "Last cron job execution duration in seconds", type: "gauge", labels: ["job"] },
    { name: `${PREFIX}_last_result`, help: "Last cron job result (1=ok, 0=error)", type: "gauge", labels: ["job"] },
    { name: `${PREFIX}_last_start_timestamp_seconds`, help: "Last cron job start timestamp", type: "gauge", labels: ["job"] },
    { name: `${PREFIX}_last_end_timestamp_seconds`, help: "Last cron job end timestamp", type: "gauge", labels: ["job"] },
    { name: `${PREFIX}_consecutive_failures_total`, help: "Consecutive failures for a cron job", type: "gauge", labels: ["job"] },
  ];

  /**
   * 采集 Cron 指标
   * 并行调用 cron.status 和 cron.list
   */
  async collect(): Promise<MetricSample[]> {
    const [status, listResult] = await Promise.all([
      rpcCall<CronStatus>("cron.status"),
      rpcCall<unknown>("cron.list", CRON_LIST_PARAMS),
    ]);
    const samples: MetricSample[] = [];

    samples.push({
      name: `${PREFIX}_scheduler_enabled`,
      value: status.enabled !== undefined ? (status.enabled ? 1 : 0) : 1,
    });

    const jobs = normalizeJobs(listResult);
    const totalJobs =
      typeof (listResult as { total?: unknown })?.total === "number"
        ? ((listResult as { total: number }).total)
        : status.jobCount ?? jobs.length;
    const runningJobs = jobs.filter((j) => {
      const state = j.state as Record<string, unknown> | undefined;
      return state?.running === true;
    }).length;

    samples.push({ name: `${PREFIX}_total`, value: totalJobs });
    samples.push({ name: `${PREFIX}_running`, value: runningJobs });

    for (const job of jobs) {
      const jobName = sanitizeLabel(String((job as Record<string, unknown>).name ?? (job as Record<string, unknown>).id ?? "unknown"));
      const state = (job as Record<string, unknown>).state as Record<string, unknown> | undefined;

      if (state) {
        const lastDurationMs = numberLike(state.lastDurationMs) || numberLike(state.lastRunDurationMs);
        if (lastDurationMs > 0) {
          samples.push({ name: `${PREFIX}_last_duration_seconds`, labels: { job: jobName }, value: lastDurationMs / 1000 });
        }

        const lastRunStatus = state.lastRunStatus ?? state.lastStatus;
        if (typeof lastRunStatus === "string") {
          samples.push({ name: `${PREFIX}_last_result`, labels: { job: jobName }, value: lastRunStatus === "ok" ? 1 : 0 });
        }

        const lastStartAt = numberLike(state.lastStartAtMs) || numberLike(state.lastRunAtMs);
        if (lastStartAt > 0) {
          samples.push({ name: `${PREFIX}_last_start_timestamp_seconds`, labels: { job: jobName }, value: lastStartAt / 1000 });
        }

        const lastEndAt = numberLike(state.lastEndAtMs);
        if (lastEndAt > 0) {
          samples.push({ name: `${PREFIX}_last_end_timestamp_seconds`, labels: { job: jobName }, value: lastEndAt / 1000 });
        }

        const consecutiveErrors = numberLike(state.consecutiveErrors);
        if (consecutiveErrors > 0) {
          samples.push({ name: `${PREFIX}_consecutive_failures_total`, labels: { job: jobName }, value: consecutiveErrors });
        }

        const nextRunAt = numberLike((job as Record<string, unknown>).nextRunAtMs) || numberLike((job as Record<string, unknown>).nextRunAt);
        if (nextRunAt > 0) {
          const overdueSeconds = (Date.now() - nextRunAt) / 1000;
          if (overdueSeconds > 0) {
            samples.push({ name: `${PREFIX}_overdue_seconds`, labels: { job: jobName }, value: overdueSeconds });
          }
        }
      }
    }

    return samples;
  }
}

function normalizeJobs(listResult: unknown): CronJob[] {
  if (Array.isArray(listResult)) {
    return listResult as CronJob[];
  }
  if (listResult && typeof listResult === "object") {
    const obj = listResult as Record<string, unknown>;
    if (Array.isArray(obj.jobs)) {
      return obj.jobs as CronJob[];
    }
  }
  return [];
}

function numberLike(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
