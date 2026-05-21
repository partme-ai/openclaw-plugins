/**
 * Type declarations for OpenClaw SDK
 *
 * This file provides type safety for the OpenClaw Plugin API when the SDK
 * is not available locally. The actual types are defined in the `openclaw` package.
 */

export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface PluginConfig {
  get<T = unknown>(key: string): T | undefined;
  get<T = unknown>(key: string, defaultValue: T): T;
  has(key: string): boolean;
  keys(): string[];
  all(): Record<string, unknown>;
}

export interface PluginApi {
  /**
   * Plugin configuration object
   */
  readonly pluginConfig: PluginConfig;

  /**
   * Logger instance for this plugin
   */
  readonly logger: PluginLogger;

  /**
   * Runtime configuration
   */
  readonly runtime?: {
    config?: {
      channels?: Record<string, unknown>;
    };
  };
}

declare module "openclaw" {
  export interface PluginApi {
    readonly pluginConfig: PluginConfig;
    readonly logger: PluginLogger;
    readonly runtime?: {
      config?: {
        channels?: Record<string, unknown>;
      };
    };
  }
}
