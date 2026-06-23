# Problem Context

`.004` 已经提供审计总账，但系统还缺一层明确的自动化策略判断。没有 policy engine 时，后续 orchestration 或 Telegram bot 很容易把“能不能自动发”“为什么要人工审”“为什么拒绝或延后”散落在调用方里，难以复盘。

用户确认的目标是更自动化，但不是黑盒自动化：

* 无链接普通帖在账号策略允许时可以由 AI 自动发。
* 带链接帖子因为成本和风险更高，进入 Telegram human gate。
* 账号主题、预算、频率、风格禁用词必须作为硬约束。
* 每个 policy decision 必须能写入 `.004` ledger。
* 本 task 只做 dry-run policy，后续 executor / Telegram bot 再消费结果。
