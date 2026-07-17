# OpenClaw Knowledge 生产化策略（2026.7.1）

```mermaid
flowchart LR
    CODE["代码与契约门禁"] --> SANDBOX["隔离账号与真实 Provider"]
    SANDBOX --> EVAL["离线 RAG 评测"]
    EVAL --> LOAD["并发、重启与故障演练"]
    LOAD --> CANARY["灰度 Agent / 小流量"]
    CANARY --> PROD["生产发布"]
    PROD --> MONITOR["质量 + 延迟 + 成本监控"]
    MONITOR -->|退化| ROLLBACK["停用自动注入 / 回滚模型索引"]
    ROLLBACK --> SANDBOX
```

## 当前判断

2026.7.1 已完成代码级安全和兼容性收口，但用户尚未在真实 embedding 服务与业务数据上验收，因此不能仅凭单元测试宣称生产就绪。

## 上线前验证顺序

1. 用真实 provider 验证 embedding 维度、批量限制、超时和错误响应。
2. 建立独立测试账号，验证跨 account、bot/agent、owner/non-owner 的 ACL 矩阵。
3. 对真实数据集评测 Recall@K、MRR、答案引用正确率和空召回率。
4. 压测 SQLite 并发写入、FTS 查询和 Gateway 重启恢复。
5. 验证文件白名单、符号链接越界、大文件和不支持后缀均被拒绝。
6. 演练 embedding 模型切换后的全量重建和回滚。

## 可观测性缺口

当前插件通过 OpenClaw logger 报告失败，但尚无独立的检索延迟、召回数、embedding 调用量、失败率和索引积压指标。进入高流量生产前，应将这些指标接入现有 Prometheus 插件或统一 tracing 体系，并避免记录原文、密钥和完整文件路径。

## 扩展原则

外部向量数据库、文档解析和 URL 抓取应以单独 adapter 加契约测试引入；在依赖、安装、健康检查和真实环境验证完成前，不加入独立插件 manifest 的正式配置面。

## 上线判定

只有代码门禁通过不能称为生产就绪。生产签字至少需要：真实 Provider 成功率和 P95 延迟达标、
目标数据集评测有基线、租户隔离测试通过、索引可备份/恢复、模型切换有回滚方案、日志和指标
不包含原文与密钥。任一项缺失时应保持“已实现但待环境验收”的状态。
