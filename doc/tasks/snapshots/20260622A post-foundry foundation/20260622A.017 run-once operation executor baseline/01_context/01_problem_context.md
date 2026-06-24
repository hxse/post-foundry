# Problem Context

`.016` 已经解决两个生产入口、循环调度和账号级锁，但业务 executor 尚未接真实 provider。这里必须避免一个容易造成长期混乱的设计：把 `run-once-online` / `run-loop-online` 接到假数据 fixture，让生产入口看起来能跑完整流程，却默认把假 trace 写进正式 runtime DB。

`.017` 因此只把 fixture executor 作为离线验证和显式 debug 工具：它能准备账号配置快照、账号初始 prompt hash、source fixture、recent posts、draft output、policy context 和 fake Telegram sender，然后调用 `.013` 的 offline orchestration。这个链路用于验证 executor 边界和 ledger 语义，不代表生产链路已经可用。

生产入口保持纯粹：未来接真实生产 executor 后，生产入口跑的就是真实 source/LLM/policy/publisher 流程；现在没接好时就明确 `not_wired`，不伪装成一次生产 run。
