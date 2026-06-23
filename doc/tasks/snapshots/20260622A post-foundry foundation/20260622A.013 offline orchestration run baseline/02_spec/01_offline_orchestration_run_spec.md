# Offline Orchestration Run Spec

## Pipeline

`runOfflineOrchestration` 必须按顺序执行：

1. `buildTopicRadar` + `recordTopicRadarSelection`
2. `buildSourceContext` + `recordSourceContextIngestion`
3. `createDraftInputPackageFromSourceContext`
4. `parseAiPostingDraftOutput` + `recordDraftRun`
5. `evaluateDraftForPosting`
6. 若 draft gate ready：`evaluateAutomationPolicy`
7. policy 后续动作：
   * `auto_post`: 只记录 `x_official_auto_post_planned`，状态 `skipped`，不得调用 X official API。
   * `human_review`: 只允许通过 `mode = offline_fake` 的 fake Telegram sender 调用 `.007` delivery helper。
   * `reject` / `defer`: 记录 `policy_terminal_noop`，状态 `skipped`。
8. 若 draft gate blocked：记录 `draft_gate_blocked`，不得进入 policy。

## Trace And Ledger

一次离线 orchestration run 必须使用同一个 `trace_id` 串起：

* topic selection run / audit event
* source context run / audit event
* draft run / audit event
* policy run / decision / audit event
* final action / audit event

policy evaluation 必须在一个 transaction 中同时写入：

* `ai_runs` purpose `automation_policy`
* `ai_decisions` decision type `automation_policy`
* `audit_events` event type `automation_policy_decided`

## Offline Boundary

`.013` 不得导入或实例化真实 X official publisher、TwitterAPI.io online client、Telegram notifier、browser automation、scheduler 或 online LLM。

Telegram 分支只能接受 `OfflineTelegramNotificationSender`，其类型必须带 `mode: "offline_fake"`，避免把真实 Telegram adapter 误接进离线闭环。

auto-post 分支只能记录 planned action；真实发帖 executor 后续另开任务。

## Acceptance

离线测试必须证明：

* 无链接短帖能走完整链路并落 `x_official_auto_post_planned`，不发送 Telegram。
* 带链接帖能走完整链路并通过 fake Telegram sender 落通知 action。
* 格式化 / 不自然草稿会停在 draft gate，不进入 policy。
* ledger 不包含 prompt 明文，只包含 prompt hash。
* 同账号所有 audit events 使用同一个 trace id。
* 其他账号没有被写入 runtime 数据。

本任务不得执行在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth、新闻抓取、网页登录或真实发帖。
