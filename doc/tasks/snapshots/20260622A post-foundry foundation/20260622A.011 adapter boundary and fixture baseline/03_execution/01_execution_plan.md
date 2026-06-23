# Execution Plan

1. 新增 source adapter boundary 模块。
2. 实现 TwitterAPI.io public X search 到 `SourceMaterialInput` 的 mapper。
3. 实现 manual notes fixture mapper。
4. 实现 web/news fixture mapper。
5. 实现 `recordSourceAdapterApiAudit`。
6. 增加 `just test-source-adapters-offline`。
7. 增加离线 adapter fixture 测试。
8. 跑离线验证，不执行任何在线服务调用。
