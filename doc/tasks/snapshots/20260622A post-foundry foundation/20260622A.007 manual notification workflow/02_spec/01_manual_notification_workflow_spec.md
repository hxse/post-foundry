# Manual Notification Workflow Spec

## Inputs

Workflow 输入：

* `AutomationPolicyDecision`
* candidate:
  * `id`
  * `text`
  * `urls`
  * `evidenceIds`
* `.004` ledger ids:
  * `policyDecisionId`
  * `actionId`
  * `auditEventId`
  * `traceId`

## Planner

`planManualNotification` 只在以下条件同时满足时返回通知计划：

* `decision.outcome = human_review`
* `decision.route = telegram_human_gate`

否则返回 `policy_not_notifiable`。

通知文本必须包含：

* 账号 key。
* candidate id。
* policy outcome / route。
* 触发通知的原因。
* 候选帖正文。
* 链接列表。
* evidence ids。
* 明确说明：这条不会自动发布，需要人工处理。

## Delivery

`deliverManualNotification`：

* 对不需要通知的 policy decision 不调用 Telegram。
* 同一个 `policyDecisionId` 已经成功通知过时，不再次发送。
* 发送成功后写入：
  * `ai_actions`: `telegram_notification_sent`
  * `audit_events`: `telegram_notification_delivered`
* 发送失败后写入：
  * `ai_actions`: `telegram_notification_failed`
  * `audit_events`: `telegram_notification_failed`
* 发送失败不抛出到调用方，返回 `failed`，避免 worker crash loop。

## Ledger

action 和 event 必须绑定 `account_uuid`、`policyDecisionId` 和 `traceId`。Telegram `message_id` 可以写入本地 ledger，但不得写入可提交文档。

## Acceptance

离线测试必须证明：

* `human_review / telegram_human_gate` 会生成通知文本。
* `auto_post`、`reject`、`defer` 不通知。
* 成功发送会写入 action 和 audit event。
* 重复调用同一个 policy decision 不会再次发送。
* 发送失败会写入 failed action 和 failed audit event，并返回 `failed`。
* 不执行真实 Telegram 发送。
