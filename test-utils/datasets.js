import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Load a JSON dataset from scripts/e2e/datasets/.
 * @param {string} relativePath - e.g. "messages/agent-inbound.json"
 */
export function loadE2eDataset(relativePath) {
  const fullPath = join(REPO_ROOT, "scripts", "e2e", "datasets", relativePath);
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

/** @returns {Record<string, unknown>} */
export function loadE2eTextPing() {
  return loadE2eDataset("text/ping.json");
}
