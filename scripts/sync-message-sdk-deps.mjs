#!/usr/bin/env node
/**
 * 将所有插件的 @partme.ai/openclaw-message-sdk 依赖同步为 workspace:^<sdkVersion>。
 *
 * Usage: node scripts/sync-message-sdk-deps.mjs
 */

import { syncMessageSdkWorkspaceDeps } from "./workspace-deps.mjs";

const { sdkVersion, target, updated } = syncMessageSdkWorkspaceDeps();

if (updated.length === 0) {
  console.log(`✅ All message-sdk deps already ${target}`);
} else {
  console.log(`✅ Synced ${updated.length} plugin(s) to ${target} (message-sdk@${sdkVersion})`);
  for (const dir of updated) console.log(`  - extensions/${dir}`);
  console.log("\nRun: pnpm install");
}
