# Execution Plan

1. 新建 `src/lib/llm/draft-adapter.ts`。
2. 实现 `buildDraftLlmRequest`：
   * 消费 `.009` `DraftRunInputPackage`。
   * 可选消费 `.014` `AccountMemorySnapshot`。
   * 只传 prompt hash，不传 prompt 明文。
   * 校验 memory 和 input package 属于同一账号。
3. 实现 `runOfflineDraftLlmAdapter`：
   * 只接受 offline fixture provider。
   * 调用 provider 后用 `.009` parser 校验输出。
4. 实现 `recordDraftLlmAdapterRun`：
   * transaction 写 `ai_runs` 和 `audit_events`。
   * ledger 中只保存 sanitized request、hash 和摘要。
5. 新增 `tests/llm-draft-adapter-offline.test.ts`。
6. 新增 `just test-llm-draft-adapter-offline` 和 package script。
7. 更新 task index 和 review 文档。
