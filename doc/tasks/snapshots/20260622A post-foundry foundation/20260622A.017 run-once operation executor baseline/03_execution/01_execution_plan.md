# Execution Plan

1. 新增 `src/lib/orchestration/run-once-operation-executor.ts`。
   * 提供 `createFixtureRunOnceOperationExecutor`。
   * 复用 `.013` 的 `runOfflineOrchestration`。
   * 内置离线 source/recent posts/draft fixture 和 fake Telegram sender。

2. 保持 production online CLI 纯净。
   * `run-once-online` 当前返回 production executor `not_wired`。
   * `run-loop-online` 当前复用 `.016` loop runner，但 operation 仍为 production executor `not_wired`。
   * 两个入口都不得写 fixture ledger。

3. 增加显式离线 fixture debug 入口。
   * `debug-run-once-offline-fixture`。
   * 必须传 `--db-file`，不默认写正式 runtime DB。

4. 增加 focused offline tests。
   * `test-run-once-operation-executor-offline`。
   * 覆盖 auto-post planned、fake Telegram、draft blocked、reject、account mismatch、loop reuse。

5. 更新任务文档和 index。

6. 验证只跑离线命令，不执行任何在线服务调用。
