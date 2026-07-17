export interface PluginManifest {
  id?: string;
  configSchema?: { type?: unknown };
  channels?: string[];
  channelConfigs?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PluginManifestAssertions {
  expectedId?: string;
  requireChannels?: boolean;
}

export function loadPluginManifest(pluginDir: string): PluginManifest;

export function assertPluginManifest(
  manifest: PluginManifest,
  opts?: PluginManifestAssertions,
): void;

export function createManifestSmokeTests(
  pluginDir: string,
  opts?: PluginManifestAssertions,
): void;

export function pluginRootFromTestFile(testFileUrl: string): string;
