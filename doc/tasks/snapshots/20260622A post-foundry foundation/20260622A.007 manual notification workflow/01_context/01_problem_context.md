# Problem Context

`.005` 已经能把候选帖分成 `auto_post`、`human_review`、`reject` 和 `defer`。`.006` 已经证明 Telegram 通知能发送到用户自己的频道。

现在需要把两者接起来：当 policy 判断候选帖需要人工处理时，系统生成 Telegram 通知并写入审计账本。

本阶段只做通知，不做审批。带链接帖通知用户的原因是：X 官方 API 发送带链接的帖子成本更高，因此这类内容先交给人工处理，而不是让系统自动发。

通知规则：

* `human_review` 且 `telegram_human_gate`：通知。
* `auto_post`：不通知，后续交给自动发帖 executor。
* `reject`：不通知，只保留 ledger 供复盘。
* `defer`：不通知，只保留 ledger 或后续 summary。

目标是把“需要你看的候选帖”推到 Telegram，同时避免通知噪音。
