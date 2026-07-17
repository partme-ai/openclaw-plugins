import assert from "node:assert/strict";
import test from "node:test";

import {
  checkDocumentationPluginIds,
  scanDocumentationText,
} from "./check-doc-plugin-ids.mjs";

test("识别插件配置路径、远程配置列表和 manifest 示例中的历史 ID", () => {
  const issues = scanDocumentationText(`
plugins.entries["openclaw-nacos"].config
"pluginConfigIds": ["openclaw-weixin"]
export default { id: "openclaw-gotify" };
`);
  assert.deepEqual(
    issues.map((issue) => issue.rule).sort(),
    ["legacy-config-path", "legacy-manifest-id", "legacy-plugin-config-id"],
  );
});

test("npm 包名、Channel ID、服务 ID 和日志前缀允许保留 openclaw 前缀", () => {
  const issues = scanDocumentationText(`
openclaw plugins install @partme.ai/openclaw-nacos
channels.openclaw-weixin
api.registerService({ id: "openclaw-nacos-config" })
[openclaw-nacos] connected
`);
  assert.deepEqual(issues, []);
});

test("仓库文档不再使用历史插件配置 ID", () => {
  const result = checkDocumentationPluginIds();
  assert.deepEqual(result.failures, []);
});

