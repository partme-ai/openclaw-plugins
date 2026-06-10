import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Load openclaw.plugin.json from a plugin directory.
 * @param {string} pluginDir - Absolute or relative path to extension root.
 */
export function loadPluginManifest(pluginDir) {
  const manifestPath = join(pluginDir, "openclaw.plugin.json");
  const raw = readFileSync(manifestPath, "utf8");
  return JSON.parse(raw);
}

/**
 * Assert common manifest fields for smoke tests.
 * @param {Record<string, unknown>} manifest
 * @param {{ expectedId?: string; requireChannels?: boolean }} [opts]
 */
export function assertPluginManifest(manifest, opts = {}) {
  expect(manifest.id, "manifest.id").toBeTruthy();
  if (opts.expectedId) {
    expect(manifest.id).toBe(opts.expectedId);
  }
  if (manifest.configSchema) {
    expect(manifest.configSchema.type).toBe("object");
  }
  if (opts.requireChannels) {
    expect(Array.isArray(manifest.channels)).toBe(true);
    expect(manifest.channels.length).toBeGreaterThan(0);
  }
}

/**
 * Vitest helper: register manifest smoke tests for a plugin directory.
 * @param {string} pluginDir
 * @param {{ expectedId?: string; requireChannels?: boolean }} [opts]
 */
export function createManifestSmokeTests(pluginDir, opts = {}) {
  describe("openclaw.plugin.json", () => {
    it("loads valid manifest with id and configSchema", () => {
      const manifest = loadPluginManifest(pluginDir);
      assertPluginManifest(manifest, opts);
    });

    it("channelConfigs keys align with channels when both present", () => {
      const manifest = loadPluginManifest(pluginDir);
      if (!manifest.channels?.length || !manifest.channelConfigs) return;
      for (const ch of manifest.channels) {
        expect(manifest.channelConfigs).toHaveProperty(ch);
      }
    });
  });
}

/**
 * Resolve plugin root from a test file URL (test/ → extension root).
 * @param {string} testFileUrl - import.meta.url of calling test file.
 */
export function pluginRootFromTestFile(testFileUrl) {
  return join(dirname(fileURLToPath(testFileUrl)), "..");
}
