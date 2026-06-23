# Execution Plan

1. 增加 source ingestion 模块，定义 source material、recent post 和 source context contract。
2. 实现 `buildSourceContext`，做账号归属校验、topic/exclude 过滤、排序和裁剪。
3. 实现 `.009` draft input package adapter。
4. 实现 source ingestion ledger helper，写 `ai_runs`、`evidence_refs` 和 `audit_events`。
5. 增加 `just test-source-ingestion-offline`。
6. 增加离线 fixture 测试。
7. 跑离线验证，不执行任何在线服务调用。
