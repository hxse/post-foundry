# Execution Plan

1. 新建 `src/lib/orchestration/offline-run.ts`。
2. 实现 `runOfflineOrchestration`，串起 topic radar、source context、draft、draft gate、policy 和 final action。
3. 为 human review 分支定义 `OfflineTelegramNotificationSender`，强制 fake sender。
4. 为 auto-post 分支记录 planned action，不接真实 X API。
5. 为 draft blocked / reject / defer 分支记录 skipped action。
6. 新增 `tests/offline-orchestration.test.ts`。
7. 新增 `just test-offline-orchestration` 和 package script。
8. 更新 task index 和 review 文档。
