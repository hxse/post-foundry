# Execution Plan

1. 新增 production source collection executor。
   * 复用 `.018` source collection。
   * 写 registry/config snapshot/source ledger。
   * 不接 draft/policy/notification/posting。

2. 新增 production runner CLI 参数解析。
   * `--config-file` 必填。
   * example config 禁止真实生产入口使用。
   * source query limits 在 CLI 层预检。

3. 改造 `prod-online-run-once` / `prod-online-run-loop` 底层 CLI。
   * once 和 loop 共用同一个 production executor。
   * loop 不复制业务逻辑。

4. 新增 focused offline tests。
   * `tests/production-run-once-offline.test.ts`。
   * `just test-offline-production-run-once`。

5. 验证只运行离线测试和类型检查，不执行在线 source collection。
