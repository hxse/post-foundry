# Execution Plan

1. 新建 `src/lib/orchestration/online-runner.ts`。
2. 实现 `runOnlineOperationOnce`：
   * 账号 key 校验。
   * trace id 构造。
   * 账号级 lock 获取和释放。
   * executor result schema 校验。
3. 实现 lock helper：
   * atomic create。
   * stale/corrupt lock cleanup。
   * heartbeat refresh。
   * lock id 校验后释放。
4. 实现 `runOnlineOperationLoop`：
   * 复用 once runner。
   * 支持 interval/jitter/sleep UTC/max iterations。
5. 新增 `src/cli/run-once-online.ts`。
6. 新增 `src/cli/run-loop-online.ts`。
7. 新增 `just run-once-online` 和 `just run-loop-online`。
8. 新增 `tests/online-runner-offline.test.ts` 和 `just test-online-runner-offline`。
9. 更新 task index 和 review 文档。
