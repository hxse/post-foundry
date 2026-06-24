# Problem Context

`.018` 已经实现了手动 debug source collection，但 production once/loop entrypoint 仍然没有接真实生产动作。后续如果要让账号自动运营，production runner 必须先能在账号锁保护下执行一轮真实公开数据采集，并把调用量、素材、证据和审计事件写入 runtime ledger。

为了控制风险，`.019` 只接 source collection：它不生成草稿、不调 LLM、不发 Telegram、不发 X 帖。这样可以先验证生产入口、账号锁、真实配置、secrets、runtime DB 和 source ledger 的连接关系。
