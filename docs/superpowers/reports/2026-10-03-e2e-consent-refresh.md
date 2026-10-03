# E2E 候选包授权摘要更新（2026-10-03）

## 范围与依据

本次只更新 `scripts/e2e/lib/install.mjs` 中 wecom、douyin 的 `APPROVED_E2E_ARTIFACT_SHA256`；能力声明、安装逻辑及其余批准摘要不变。13 个待复测插件已在当前源码上逐个构建、打包，并完成归档路径、重复及特殊条目、包与插件身份、能力声明、打包文件与当前构建字节、源码映射内容核对。预检矩阵保存在被忽略的 `scripts/e2e/reports/candidates/consent-preflight-2026-10-03T01-23-29.262Z/audit.json`，批准归档到新候选包的逐文件差异保存在同目录的 `changed-file-summary.json`。独立安全复审给出 **APPROVE**；本次按该结论仅更新两项摘要。

| 插件 | 原批准的内容摘要 | 新候选内容摘要 | 新候选原始 tgz SHA-256 |
| --- | --- | --- | --- |
| wecom | `5f931beaa49752e861897de417cc80dca79da3233c6cd0a0b194d1553f9a939a` | `f1a6201c855c401de3108680cd18d99bea944d6e5110857efe17ee7eb086b5e3` | `54bc794874cb7fcf31b2103233b454969f4c598817d30681eb714b16c9b51140` |
| douyin | `69765cc9a2c1b609f1356d388e71396a48abcc11d82a46d2ff4bb0c8ae303ddd` | `2e9b75bec2c25ea5ceafcf4a4ccb5c9b029fee9fb7517214ef9dc668994c1040` | `5aac24205656fdc695c05525b9061c3f5a5c8ebcfc2b5041d28663bf8d7634d1` |

其余 11 个预检包的内容摘要与现有批准值一致。wecom 的打包内容未附带 source map，14 个 `dist` 文件与当前构建逐字节一致；douyin 的 21 个本地 source-map 源片段与当前源码一致。两包的 `package.json`、`openclaw.plugin.json` 与旧批准归档相比未变，差异位于构建后的 `dist`。

## 本次本地检查

- `node --test scripts/e2e/lib/install.test.mjs`：3/3 PASS，零跳过。
- 从上述两个原始 tgz 重新安全解包，重算原始 SHA-256 和 `reviewedArtifactDigest`：均与表中数值及更新后的批准值一致。
- `git diff --check`：PASS；代码差异仅为两行批准摘要。

## 验证边界

此更新只表示审查过的本地候选包可以进入安装态测试，不代表插件 E2E、厂商实网回调或生产环境验收通过。此前 wecom 的本地完整运行在安装时被旧摘要拦截；douyin 本轮只完成构建和打包预检。更新摘要后仍须安装当前候选包，并在 OpenClaw 2026.9.6 上分别取得正式、零跳过的 E2E 报告。

`sourceFingerprint` 将整个 `scripts/e2e/lib/` 纳入每个运行时插件的证据输入。修改其中的 `install.mjs` 会改变全部 27 个插件的当前指纹，因此更新前针对这 27 个插件保存的报告，即便结果为 PASS，也不能作为本次提交的当前证据。更新后只读运行 `node scripts/check-e2e-evidence.mjs`，实际报告 27 项均缺少当前有效证据；仍须逐项重新执行安装态 E2E，再运行证据检查至退出 0。
