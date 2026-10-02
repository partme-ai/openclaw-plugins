# 本地 Gateway、Sidecar 与回调夹具复验

日期：2026-10-02。用户选择在本地隔离环境继续验收。使用 OpenClaw 2026.9.6、Node v24.18.0、独立 E2E profile 与当前候选 tarball；未操作端口 18789 的个人 Gateway。对应[升级规格](../specs/2026-09-29-openclaw-2026-9-6-upgrade.md)的 U8/U9。

## 安装态闭环

以下每项重新执行 `node scripts/e2e/run-e2e.mjs --plugins <id>`，OpenMem 额外设置 `OPENMEM_E2E_REPO=/Users/wandl/workspaces/workspace-agent-fabric/OpenMem`。每项 E2E 均为 PASS、`skipCount=0`；归档位于 gitignored 的 `scripts/e2e/reports/`。

| 插件 | 本地协议边界 | 本轮归档文件 |
|---|---|---|
| wecom | 加密企业微信回调、Agent Turn、回复及去重 | `2026-10-02T06-54-03.964Z-wecom-f4a5c4aa-33cc-4a2a-937a-dc79a74c0990.json` |
| wecom-kf | 加密客服回调、sync_msg、Agent Turn、send_msg 及重启去重 | `2026-10-02T06-55-11.461Z-wecom-kf-4e85592a-426a-40cf-9801-3b24d3f613c9.json` |
| wechat | iLink 长轮询、Agent Turn、回复及重启去重 | `2026-10-02T06-56-36.432Z-wechat-363d0efa-0f04-4c42-9fae-81f654867a7f.json` |
| wechat-ipad | 外部 WS/HTTP 桥接、Agent Turn、回复及持久去重 | `2026-10-02T06-57-39.643Z-wechat-ipad-50734f3b-239d-465c-aa1f-93d7aabad697.json` |
| douyin | 签名回调、持久 Inbox、Agent Turn 与重放 | `2026-10-02T06-58-48.825Z-douyin-9441f3e7-4045-4e3b-935e-decccf915fd0.json` |
| meituan | 通知/消息签名回调、持久 Inbox 与 MTOp 工具夹具 | `2026-10-02T06-59-43.628Z-meituan-4e77c915-b75a-4c53-ac78-fc606c161215.json` |
| openmem | 真实 Sidecar、Gateway Agent Turn、归档、Gateway 重启后连续召回 | `2026-10-02T07-00-39.023Z-openmem-a6e2ce2d-6e18-420c-bf89-3196fbc26022.json` |

`node scripts/check-e2e-evidence.mjs` 对全部 27 个运行时插件再次退出 0；当前源码、候选包与报告仍匹配。

## Sidecar 进程故障恢复

在 OpenMem 仓库执行 `node scripts/session-commit-process-recovery.mjs`，退出 0、结果 PASS。脚本先构建当前 Core/Server，再在 loopback 启动真实 Server：归档落盘后注入一次事实记忆写入失败，强制结束进程，以相同临时数据目录重新启动，再重试并重复提交。复验确认 `GET /sessions/:id/commit` 声明可恢复、归档与事实 ID 保持不变、各只有一份、Markdown 和检索结果包含原事实、终态为 `ARCHIVED`。输出包含本次生成的 session/archive ID；临时数据已清理。

## 证据边界

厂商侧均为本地签名或协议夹具，没有真实平台账号投递。进程测试覆盖注入故障后 `SIGKILL` 与重启，不等于机器断电或多写入者验证。Sidecar 仅绑定 loopback，未验证受保护 HTTPS 网络部署。本轮结论是**本地安装态与进程恢复通过**，不宣称厂商实网或生产环境完成验收。
