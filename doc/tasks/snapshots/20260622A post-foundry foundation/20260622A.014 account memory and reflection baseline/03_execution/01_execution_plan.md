# Execution Plan

1. 新建 `src/lib/memory/account-memory.ts`。
2. 实现 `buildAccountMemory`：
   * 按 account_uuid 读取 ledger。
   * 聚合 trace summary、topic memory、outcome counts、action counts、next run hints。
   * 只保留 prompt hash 和 draft text hash。
3. 实现 `createAccountReflection`：
   * deterministic reflection，不调用 LLM。
4. 实现 `recordAccountReflection`：
   * transaction 写 `ai_runs`、`evidence_refs`、`audit_events`。
   * 校验账号归属和 memory hash。
5. 新增 `tests/account-memory-offline.test.ts`。
6. 新增 `just test-account-memory-offline` 和 package script。
7. 更新 task index 和 review 文档。
