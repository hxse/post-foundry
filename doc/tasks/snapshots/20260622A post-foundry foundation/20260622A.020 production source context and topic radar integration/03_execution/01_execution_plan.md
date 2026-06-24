# Execution Plan

1. 扩展 production source collection executor。
   * source collection succeeded 且有 materials 时，继续 topic radar。
   * topic radar 后构建 source context。
   * skipped/empty collection 不继续后续步骤。

2. 更新 production CLI / just 入口。
   * `prod-online-run-once` / `prod-online-run-loop` 使用 just 原生 long args。
   * executor 在 source collection 非空后 lazy-load 账号初始 prompt。
   * prompt 明文只在内存中传给 topic radar。

3. 更新 focused offline test。
   * 继续使用 `tests/production-run-once-offline.test.ts`。
   * `just test-offline-production-run-once` 验证 production once 链路。

4. 更新 task index 和 `.020` 文档。

5. 验证只运行离线测试和类型检查，不执行在线 source collection。
