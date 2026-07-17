import assert from "node:assert/strict";
import test from "node:test";

import { migratePluginConfigIds } from "./plugin-config-id-migration.mjs";

test("迁移 entries、allow 和 deny 中的历史插件 ID", () => {
  const result = migratePluginConfigIds({
    plugins: {
      entries: { "openclaw-nacos": { enabled: true } },
      allow: ["openclaw-nacos", "nacos"],
      deny: ["openclaw_wechat_ipad"],
    },
  });

  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.config.plugins.entries, { nacos: { enabled: true } });
  assert.deepEqual(result.config.plugins.allow, ["nacos"]);
  assert.deepEqual(result.config.plugins.deny, ["wechat-ipad"]);
});

test("新旧 entries 同时存在时拒绝静默覆盖", () => {
  const result = migratePluginConfigIds({
    plugins: {
      entries: {
        "openclaw-nacos": { enabled: false },
        nacos: { enabled: true },
      },
    },
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.config.plugins.entries["openclaw-nacos"].enabled, false);
  assert.equal(result.config.plugins.entries.nacos.enabled, true);
});

