/**
 * Peer dependency `openclaw` placeholder types for message-sdk bridge subpath local build.
 */

declare module "openclaw/plugin-sdk/core" {
  export type PluginRuntime = import("../bridge/types.js").BridgePluginRuntime;
}
