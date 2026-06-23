# Problem Context

`.001` 到 `.012` 已经分别落下 API 边界、账号隔离、runtime storage、ledger、policy、Telegram 通知、prompt、draft pipeline、source ingestion、adapter boundary 和 topic radar。

但这些模块仍然是分散的。项目愿景是让 AI 自动化运营 X 账号，而且最重要的是可沉淀、可复盘、可审计。下一步必须证明：一个账号的一次运营决策可以从素材到选题、从选题到草稿、从草稿到 policy、从 policy 到离线动作计划或人工通知，完整串在同一个 trace 下。

`.013` 因此只做离线编排 baseline。它不接真实 LLM、真实 X 或真实 Telegram，只接 fake draft output 和 fake Telegram sender。
