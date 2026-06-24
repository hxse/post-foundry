# Execution Plan

1. 新增 `src/lib/context/source-collection.ts`。
   * `collectAccountPublicXSourceBatch`。
   * 复用 `.011` TwitterAPI.io adapter。
   * 写 API audit、AI run、evidence refs、audit event。

2. 新增手动 online debug CLI。
   * `src/cli/debug-online-source-collection.ts`。
   * 默认 dry-run。
   * `--collect` 才访问 TwitterAPI.io。

3. 新增 focused offline tests。
   * `tests/source-collection-offline.test.ts`。
   * `just test-offline-source-collection`。

4. 更新 task index 和 `.018` 文档。

5. 验证只运行离线测试和类型检查，不执行在线 source collection。
