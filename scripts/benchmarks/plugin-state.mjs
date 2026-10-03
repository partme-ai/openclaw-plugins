#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, mkdtemp, readdir, rm, stat, statfs } from "node:fs/promises";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RESERVE_BYTES = 8 * 1024 ** 3;
const GROUP_BUDGET_BYTES = 512 * 1024 ** 2;
const AGENT = "benchmark-agent";
const SESSION = "benchmark-session";
const CREATED_AT = "2026-09-29T00:00:00.000Z";

function recordAt(seed, index) {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  const token = (value >>> 0).toString(16).padStart(8, "0");
  return { id: `r-${index.toString(36)}-${token}`, content: `Synthetic service event ${token} needle`, keywords: ["needle", token] };
}

/** Deterministic, synthetic input shared by both real stores. */
export function generateDataset({ seed, count }) {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("seed must be a non-negative safe integer");
  if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) throw new Error("count must be an integer between 1 and 100000");
  const records = Array.from({ length: count }, (_, index) => recordAt(seed, index));
  const hash = createHash("sha256").update(JSON.stringify({ seed, count, records })).digest("hex");
  return { seed, count, hash, records };
}

export function evaluateCapacity({ kind, count, limit, bytes }) {
  if (kind === "router" && count > limit) return { accepted: false, reason: "configured-capacity", limit };
  if (kind === "memory" && bytes > limit) return { accepted: false, reason: "search-byte-budget", limit };
  return { accepted: true };
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function round(value) {
  return Number(value.toFixed(6));
}

/** Failed operations are counted separately and never supply a latency value. */
export function summarizeSamples(samples, unitsPerOperation) {
  const good = samples.filter((sample) => sample.ok === true && Number.isFinite(sample.durationMs) && sample.durationMs > 0);
  const latencies = good.map((sample) => sample.durationMs);
  const delays = good.map((sample) => sample.eventLoopDelayMs).filter((value) => Number.isFinite(value) && value >= 0);
  const totalMs = latencies.reduce((sum, value) => sum + value, 0);
  return {
    sampleCount: samples.length,
    successCount: good.length,
    failureCount: samples.length - good.length,
    p50Ms: latencies.length ? round(percentile(latencies, 0.5)) : null,
    p95Ms: latencies.length ? round(percentile(latencies, 0.95)) : null,
    throughputPerSec: totalMs ? round((good.length * unitsPerOperation * 1000) / totalMs) : null,
    bytesScanned: good.reduce((sum, sample) => sum + sample.bytesScanned, 0),
    bytesWritten: good.reduce((sum, sample) => sum + sample.bytesWritten, 0),
    eventLoopDelaySampleCount: delays.length,
    eventLoopDelayP95Ms: delays.length ? round(percentile(delays, 0.95)) : null,
  };
}

async function sourceModules() {
  const { tsImport } = await import("tsx/esm/api");
  const load = (name) => tsImport(pathToFileURL(resolve(ROOT, name)).href, import.meta.url);
  const [memoryStore, memoryConfig, routerStore, routerConfig] = await Promise.all([
    load("extensions/memory/src/store.ts"),
    load("extensions/memory/src/config.ts"),
    load("extensions/router/src/durable-store.ts"),
    load("extensions/router/src/config.ts"),
  ]);
  return { MemoryStore: memoryStore.MemoryStore, resolveMemoryConfig: memoryConfig.resolveConfig,
    DurableRouteStore: routerStore.DurableRouteStore, resolveRouterConfig: routerConfig.resolveRouterConfig };
}

function memoryRecord(record) {
  return { ...record, level: "L1", type: "episodic", agentId: AGENT, sessionKey: SESSION, createdAt: CREATED_AT };
}

function routerTask(record, index) {
  return { id: record.id, dedupeKey: record.id, ruleId: "benchmark-rule", actionType: "forward",
    payload: { channel: "benchmark", content: record.content }, attempts: 0,
    createdAt: Date.parse(CREATED_AT) + index, nextAttemptAt: Date.parse(CREATED_AT) + index };
}

async function fileBytes(root, suffix) {
  let bytes = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const pathname = join(root, entry.name);
    if (entry.isDirectory()) bytes += await fileBytes(pathname, suffix);
    else if (entry.isFile() && pathname.endsWith(suffix)) bytes += (await stat(pathname)).size;
  }
  return bytes;
}

async function measure(operation) {
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  const started = performance.now();
  try {
    const result = await operation();
    const durationMs = performance.now() - started;
    return { ok: true, durationMs, ...result, eventLoopDelayMs: delay.max > 0 ? delay.max / 1e6 : null };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) };
  } finally {
    delay.disable();
  }
}

function errorText(error) {
  return String(error instanceof Error ? error.message : error);
}

/** One isolated dataset per group; setup and warmup are outside measured samples. */
export async function runGroup({ kind, seed, count, runs = 5 }) {
  if (!["memory", "router"].includes(kind)) throw new Error("kind must be memory or router");
  if (!Number.isSafeInteger(runs) || runs < 5) throw new Error("runs must be at least 5");
  const dataset = generateDataset({ seed, count });
  const modules = await sourceModules();
  const memoryConfig = modules.resolveMemoryConfig({ pluginConfig: {} });
  const routerConfig = modules.resolveRouterConfig({ pluginConfig: {} });
  const records = kind === "memory" ? dataset.records.map(memoryRecord) : dataset.records.map(routerTask);
  const estimatedBytes = records.reduce((sum, record) => sum + Buffer.byteLength(JSON.stringify(record), "utf8") + 1, 0);
  const config = kind === "memory" ? {
    maxSearchBytes: memoryConfig.maxSearchBytes, maxRecordBytes: memoryConfig.maxRecordBytes,
    profileScope: memoryConfig.profileScope, encrypted: false,
  } : {
    maxPendingTasks: routerConfig.delivery.maxPendingTasks, maxPayloadBytes: routerConfig.delivery.maxPayloadBytes,
    auditEnabled: routerConfig.audit.enabled, encrypted: false,
  };
  const base = { kind, seed, count, datasetHash: dataset.hash, estimatedBytes, config, warmupCount: 0, samples: [] };
  const capacity = evaluateCapacity({ kind, count,
    limit: kind === "memory" ? config.maxSearchBytes : config.maxPendingTasks, bytes: estimatedBytes });
  if (!capacity.accepted) return { ...base, status: "rejected", rejection: capacity };
  if (estimatedBytes > GROUP_BUDGET_BYTES) {
    return { ...base, status: "rejected", rejection: { accepted: false, reason: "temporary-space-budget", limit: GROUP_BUDGET_BYTES } };
  }
  const filesystem = await statfs(tmpdir());
  const freeBytes = filesystem.bavail * filesystem.bsize;
  if (freeBytes - RESERVE_BYTES < Math.max(GROUP_BUDGET_BYTES, estimatedBytes * 4)) {
    return { ...base, status: "rejected", rejection: { accepted: false, reason: "free-space-reserve", freeBytes, reserveBytes: RESERVE_BYTES } };
  }
  const directory = await mkdtemp(join(tmpdir(), `openclaw-plugin-state-${kind}-`));
  let store;
  try {
    const setupStarted = performance.now();
    if (kind === "memory") {
      store = new modules.MemoryStore({ ...memoryConfig, dataDir: directory });
      await store.initialize();
      await store.appendRecords(records);
      const storedBytes = await fileBytes(directory, ".jsonl");
      base.setupMs = round(performance.now() - setupStarted);
      base.setupBytesWritten = storedBytes;
      base.measuredOperation = "MemoryStore.search(session scoped, lexical needle)";
      const manager = store.createSearchManager(AGENT);
      const query = async () => {
        const found = await manager.search("needle", { sessionKey: SESSION, maxResults: 10 });
        if (found.length === 0) throw new Error("memory search returned no matching records");
        return { bytesScanned: storedBytes, bytesWritten: 0, resultCount: found.length };
      };
      const warmup = await measure(query);
      if (!warmup.ok) throw new Error(`memory warmup: ${warmup.error}`);
      base.warmupCount = 1;
      base.warmupMs = round(warmup.durationMs);
      for (let index = 0; index < runs; index++) base.samples.push(await measure(query));
      base.storedBytes = storedBytes;
    } else {
      store = new modules.DurableRouteStore(directory, routerConfig);
      await store.initialize();
      const seeded = await store.enqueueBatch(records);
      if (seeded.enqueued !== count) throw new Error(`router seeded ${seeded.enqueued} of ${count}`);
      base.setupMs = round(performance.now() - setupStarted);
      base.setupBytesWritten = (await stat(join(directory, "delivery-state.json"))).size;
      base.measuredOperation = "DurableRouteStore.markFailed(retry, whole-state persist)";
      const update = async () => {
        const outcome = await store.markFailed(records[0], "synthetic benchmark retry", Date.now() + 60_000);
        if (outcome !== "retry") throw new Error(`router returned ${outcome}`);
        return { bytesScanned: 0, bytesWritten: (await stat(join(directory, "delivery-state.json"))).size };
      };
      const warmup = await measure(update);
      if (!warmup.ok) throw new Error(`router warmup: ${warmup.error}`);
      base.warmupCount = 1;
      base.warmupMs = round(warmup.durationMs);
      for (let index = 0; index < runs; index++) base.samples.push(await measure(update));
      base.storedBytes = (await stat(join(directory, "delivery-state.json"))).size;
    }
    const summary = summarizeSamples(base.samples, kind === "memory" ? count : 1);
    return { ...base, status: summary.failureCount ? "partial" : "measured", summary };
  } catch (error) {
    return { ...base, status: "failed", error: errorText(error), summary: summarizeSamples(base.samples, kind === "memory" ? count : 1) };
  } finally {
    await store?.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

function readArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!name?.startsWith("--") || argv[index + 1] === undefined) throw new Error(`invalid argument: ${name}`);
    options[name.slice(2)] = argv[index + 1];
  }
  const parseCounts = (value, fallback) => (value ?? fallback).split(",").map((text) => {
    const number = Number(text);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error(`invalid count: ${text}`);
    return number;
  });
  const seed = Number(options.seed ?? 20260929);
  const runs = Number(options.runs ?? 5);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("invalid seed");
  if (!Number.isSafeInteger(runs) || runs < 5) throw new Error("runs must be at least 5");
  return { seed, runs, memoryCounts: parseCounts(options["memory-counts"], "1000,10000,100000"),
    routerCounts: parseCounts(options["router-counts"], "100,1000,10000") };
}

async function main() {
  const options = readArguments(process.argv.slice(2));
  const sourcePaths = ["extensions/memory/src/store.ts", "extensions/router/src/durable-store.ts"];
  const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async (name) =>
    [name, createHash("sha256").update(await readFile(resolve(ROOT, name))).digest("hex")])));
  const groups = [];
  for (const count of options.memoryCounts) groups.push(await runGroup({ kind: "memory", seed: options.seed, count, runs: options.runs }));
  for (const count of options.routerCounts) groups.push(await runGroup({ kind: "router", seed: options.seed, count, runs: options.runs }));
  const cpu = cpus()[0];
  const output = { schema: 1, generatedAt: new Date().toISOString(), sourceHashes,
    environment: { node: process.version, platform: platform(), osRelease: release(),
      cpuModel: cpu?.model, cpuCount: cpus().length, totalMemoryBytes: totalmem(),
      tempFilesystem: tmpdir(), reserveBytes: RESERVE_BYTES, groupBudgetBytes: GROUP_BUDGET_BYTES },
    options, groups };
  console.log(JSON.stringify(output, null, 2));
  if (groups.some((group) => group.status === "failed" || group.status === "partial")) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(errorText(error)); process.exitCode = 1; });
}
