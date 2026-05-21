import type {
  MetricCollector,
  MetricDefinition,
  MetricSample,
  ModelAuthProvider,
  ModelAuthStatusSnapshot,
  ModelAuthWindow,
} from "../types.js";
import { rpcCall } from "../ws-bridge.js";
import { sanitizeLabel } from "../utils.js";

const PREFIX = "openclaw_model_auth";
const PROVIDER_STATUSES = ["ok", "expiring", "expired", "missing", "static"] as const;

export class ModelAuthCollector implements MetricCollector {
  name = "model-auth";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_providers_total`, help: "Configured auth providers returned by models.authStatus", type: "gauge" },
    { name: `${PREFIX}_providers_expiring_total`, help: "Providers currently in expiring state", type: "gauge" },
    { name: `${PREFIX}_providers_expired_total`, help: "Providers currently in expired or missing state", type: "gauge" },
    {
      name: `${PREFIX}_provider_status`,
      help: "Provider auth status as one-hot gauge by provider and status",
      type: "gauge",
      labels: ["provider", "status"],
    },
    {
      name: `${PREFIX}_provider_profiles_total`,
      help: "Number of auth profiles exposed for this provider",
      type: "gauge",
      labels: ["provider"],
    },
    {
      name: `${PREFIX}_provider_expiry_timestamp_seconds`,
      help: "Absolute credential expiry timestamp for the provider",
      type: "gauge",
      labels: ["provider"],
    },
    {
      name: `${PREFIX}_provider_remaining_seconds`,
      help: "Remaining seconds until provider credential expiry",
      type: "gauge",
      labels: ["provider"],
    },
    {
      name: `${PREFIX}_provider_usage_used_ratio`,
      help: "Provider usage window used ratio (0-1)",
      type: "gauge",
      labels: ["provider", "window"],
    },
    {
      name: `${PREFIX}_provider_usage_remaining_ratio`,
      help: "Provider usage window remaining ratio (0-1)",
      type: "gauge",
      labels: ["provider", "window"],
    },
    {
      name: `${PREFIX}_provider_usage_reset_timestamp_seconds`,
      help: "Provider usage window reset timestamp",
      type: "gauge",
      labels: ["provider", "window"],
    },
  ];

  async collect(): Promise<MetricSample[]> {
    const snapshot = await rpcCall<ModelAuthStatusSnapshot>("models.authStatus");
    const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : [];
    const samples: MetricSample[] = [
      { name: `${PREFIX}_providers_total`, value: providers.length },
    ];

    let expiring = 0;
    let expiredOrMissing = 0;

    for (const providerSnapshot of providers) {
      const provider = sanitizeLabel(providerSnapshot.provider || providerSnapshot.displayName || "unknown");
      const status = typeof providerSnapshot.status === "string" ? providerSnapshot.status : "missing";
      if (status === "expiring") {
        expiring += 1;
      }
      if (status === "expired" || status === "missing") {
        expiredOrMissing += 1;
      }

      for (const candidate of PROVIDER_STATUSES) {
        samples.push({
          name: `${PREFIX}_provider_status`,
          labels: { provider, status: candidate },
          value: status === candidate ? 1 : 0,
        });
      }

      samples.push({
        name: `${PREFIX}_provider_profiles_total`,
        labels: { provider },
        value: Array.isArray(providerSnapshot.profiles) ? providerSnapshot.profiles.length : 0,
      });

      appendExpirySamples(samples, provider, providerSnapshot);
      appendUsageWindowSamples(samples, provider, providerSnapshot.usage?.windows);
    }

    samples.push({ name: `${PREFIX}_providers_expiring_total`, value: expiring });
    samples.push({ name: `${PREFIX}_providers_expired_total`, value: expiredOrMissing });

    return samples;
  }
}

function appendExpirySamples(
  samples: MetricSample[],
  provider: string,
  providerSnapshot: ModelAuthProvider,
): void {
  const expiresAtMs = providerSnapshot.expiry?.at;
  const remainingMs = providerSnapshot.expiry?.remainingMs;
  if (typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs)) {
    samples.push({
      name: `${PREFIX}_provider_expiry_timestamp_seconds`,
      labels: { provider },
      value: expiresAtMs / 1000,
    });
  }
  if (typeof remainingMs === "number" && Number.isFinite(remainingMs)) {
    samples.push({
      name: `${PREFIX}_provider_remaining_seconds`,
      labels: { provider },
      value: remainingMs / 1000,
    });
  }
}

function appendUsageWindowSamples(
  samples: MetricSample[],
  provider: string,
  windows: ModelAuthWindow[] | undefined,
): void {
  if (!Array.isArray(windows)) {
    return;
  }
  for (const windowSnapshot of windows) {
    const window = sanitizeLabel(windowSnapshot.label || "default");
    const usedPercent =
      typeof windowSnapshot.usedPercent === "number" && Number.isFinite(windowSnapshot.usedPercent)
        ? windowSnapshot.usedPercent
        : 0;
    samples.push({
      name: `${PREFIX}_provider_usage_used_ratio`,
      labels: { provider, window },
      value: usedPercent / 100,
    });
    samples.push({
      name: `${PREFIX}_provider_usage_remaining_ratio`,
      labels: { provider, window },
      value: Math.max(0, 1 - usedPercent / 100),
    });
    if (typeof windowSnapshot.resetAt === "number" && Number.isFinite(windowSnapshot.resetAt)) {
      samples.push({
        name: `${PREFIX}_provider_usage_reset_timestamp_seconds`,
        labels: { provider, window },
        value: windowSnapshot.resetAt / 1000,
      });
    }
  }
}

