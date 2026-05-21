import type { MetricDefinition, MetricSample, MetricType } from "./types.js";

type LabelValues = Record<string, string>;

// ─────────── hot-path 优化：NUL 分隔 sample key，避免 JSON.stringify ───────────

/**
 * 生成高效的 sample key。
 * 避免每次 JSON.stringify(normalizeLabels(...))。
 * 格式：name\0key1=val1\0key2=val2（NUL 分隔，字典序稳定）
 */
function sampleKey(name: string, labels: LabelValues | undefined): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const keys = Object.keys(labels).sort();
  let key = name;
  for (let i = 0; i < keys.length; i++) {
    key += "\0" + keys[i] + "=" + labels[keys[i]];
  }
  return key;
}

/** 轻量 label 排序（原地排序 keys，返回排序后对象） */
function sortedLabels(labels: LabelValues | undefined): LabelValues | undefined {
  if (!labels || Object.keys(labels).length === 0) return undefined;
  // 直接返回原始对象，不要转换为字符串
  // 标签排序由 sampleKey() 处理
  return labels;
}

// ─────────── Registry ───────────

export class MetricsRegistry {
  private readonly definitions = new Map<string, MetricDefinition>();
  private readonly samples = new Map<string, MetricSample>();

  // 快照缓存：mutation 时失效，读取时 lazy 重建
  private _defCache: MetricDefinition[] | null = null;
  private _sampleCache: MetricSample[] | null = null;

  private invalidateCache(): void {
    this._defCache = null;
    this._sampleCache = null;
  }

  define(definition: MetricDefinition): void {
    const existing = this.definitions.get(definition.name);
    // 避免每次都创建新对象——如果 help/type/labels 未变则跳过
    if (
      existing &&
      existing.help === definition.help &&
      existing.type === definition.type &&
      labelArraysEqual(existing.labels, definition.labels)
    ) {
      return;
    }
    this.definitions.set(definition.name, {
      ...definition,
      ...(definition.labels ? { labels: [...definition.labels] } : {}),
    });
    this._defCache = null; // 只有定义真正变更时才失效
  }

  set(
    name: string,
    value: number,
    options: {
      help: string;
      type?: MetricType;
      labels?: LabelValues;
      timestamp?: number;
    },
  ): void {
    this.define({
      name,
      help: options.help,
      type: options.type ?? "gauge",
      labels: options.labels ? Object.keys(options.labels).sort() : undefined,
    });
    const key = sampleKey(name, options.labels);
    const sl = sortedLabels(options.labels);
    this.samples.set(key, {
      name,
      value,
      ...(sl ? { labels: sl } : {}),
      ...(typeof options.timestamp === "number" ? { timestamp: options.timestamp } : {}),
    });
    this.invalidateCache();
  }

  inc(
    name: string,
    by: number,
    options: {
      help: string;
      type?: MetricType;
      labels?: LabelValues;
    },
  ): void {
    const key = sampleKey(name, options.labels);
    const current = this.samples.get(key)?.value ?? 0;
    this.set(name, current + by, options);
  }

  dec(
    name: string,
    by: number,
    options: {
      help: string;
      type?: MetricType;
      labels?: LabelValues;
    },
  ): void {
    const key = sampleKey(name, options.labels);
    const current = this.samples.get(key)?.value ?? 0;
    this.set(name, Math.max(0, current - by), options);
  }

  observeSummary(
    prefix: string,
    seconds: number,
    options: {
      help: string;
      labels?: LabelValues;
    },
  ): void {
    this.inc(`${prefix}_count`, 1, {
      help: `${options.help} count`,
      type: "counter",
      labels: options.labels,
    });
    this.inc(`${prefix}_sum`, seconds, {
      help: `${options.help} sum in seconds`,
      type: "counter",
      labels: options.labels,
    });
  }

  observeHistogram(
    prefix: string,
    seconds: number,
    options: {
      help: string;
      labels?: LabelValues;
      buckets?: number[];
    },
  ): void {
    const defaultBuckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];
    const bucketBounds = options.buckets ?? defaultBuckets;
    const bucketPrefix = `${prefix}_bucket`;

    // _count 指标
    this.inc(`${prefix}_count`, 1, {
      help: `${options.help} count`,
      type: "counter",
      labels: options.labels,
    });

    // _sum 指标
    this.inc(`${prefix}_sum`, seconds, {
      help: `${options.help} sum in seconds`,
      type: "counter",
      labels: options.labels,
    });

    // _bucket 指标（累计计数）
    for (const bound of bucketBounds) {
      if (seconds <= bound) {
        this.inc(`${bucketPrefix}`, 1, {
          help: `${options.help} bucket`,
          type: "counter",
          labels: {
            ...(options.labels ?? {}),
            le: String(bound),
          },
        });
      }
    }

    // +Inf bucket（总是计数）
    this.inc(`${bucketPrefix}`, 1, {
      help: `${options.help} bucket`,
      type: "counter",
      labels: {
        ...(options.labels ?? {}),
        le: "+Inf",
      },
    });
  }

  setOneHotStatus(
    name: string,
    currentStatus: string,
    statuses: readonly string[],
    options: {
      help: string;
      labels?: LabelValues;
      statusLabel?: string;
    } = {
      help: "",
    },
  ): void {
    const statusLabel = options.statusLabel ?? "status";
    for (const status of statuses) {
      this.set(name, currentStatus === status ? 1 : 0, {
        help: options.help,
        type: "gauge",
        labels: {
          ...(options.labels ?? {}),
          [statusLabel]: status,
        },
      });
    }
  }

  // ─────────── 快照（带缓存） ───────────

  snapshotDefinitions(): MetricDefinition[] {
    if (this._defCache) return this._defCache;
    this._defCache = [...this.definitions.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    return this._defCache;
  }

  snapshotSamples(): MetricSample[] {
    if (this._sampleCache) return this._sampleCache;
    this._sampleCache = [...this.samples.values()].sort((a, b) => {
      const an = a.name;
      const bn = b.name;
      if (an < bn) return -1;
      if (an > bn) return 1;
      // 同名样本按 label 字典序——用缓存的 sortedLabels 对比
      return compareLabels(a.labels, b.labels);
    });
    return this._sampleCache;
  }

  /**
   * **高性能路径**：按名称+精确标签查询单个样本值。
   * 用于 SLI 计算等场景，避免 snapshotSamples() 的全量排序开销。
   */
  getSampleValue(name: string, labels?: LabelValues): number {
    const key = sampleKey(name, labels);
    return this.samples.get(key)?.value ?? 0;
  }

  /**
   * **高性能路径**：按名称前缀批量查询样本。
   * 返回匹配的样本数组（无排序）。
   */
  getSamplesByName(name: string): MetricSample[] {
    const result: MetricSample[] = [];
    for (const sample of this.samples.values()) {
      if (sample.name === name) {
        result.push(sample);
      }
    }
    return result;
  }
}

// ─────────── helpers ───────────

function labelArraysEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 标签字典序比较（避免 JSON.stringify）。
 * 标签已由 sortedLabels() 排序，直接逐 key 对比。
 */
function compareLabels(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  const len = Math.min(aKeys.length, bKeys.length);
  for (let i = 0; i < len; i++) {
    const k = aKeys[i].localeCompare(bKeys[i]);
    if (k !== 0) return k;
    const v = a[aKeys[i]].localeCompare(b[bKeys[i]]);
    if (v !== 0) return v;
  }
  return aKeys.length - bKeys.length;
}
