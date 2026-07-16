import type { MetricDefinition, MetricSample } from "../types.js";

export const SCRAPE_DROPPED_SERIES_NAME = "openclaw_metrics_scrape_series_dropped";

export function limitScrapeSamples(
  definitions: MetricDefinition[],
  samples: MetricSample[],
  maximum: number,
): { definitions: MetricDefinition[]; samples: MetricSample[] } {
  if (samples.length <= maximum) return { definitions, samples };
  const dropped = samples.length - maximum + 1;
  return {
    definitions: [
      ...definitions,
      {
        name: SCRAPE_DROPPED_SERIES_NAME,
        help: "Metric series omitted from this scrape because maxScrapeSeries was reached",
        type: "gauge",
      },
    ],
    samples: [
      ...samples.slice(0, Math.max(0, maximum - 1)),
      { name: SCRAPE_DROPPED_SERIES_NAME, value: dropped },
    ],
  };
}
