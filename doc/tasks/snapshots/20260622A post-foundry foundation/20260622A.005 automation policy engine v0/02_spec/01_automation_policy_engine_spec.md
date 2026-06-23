# Automation Policy Engine Spec

## Inputs

Policy engine 输入：

* `account`: `.002` 的 `AccountConfig`。
* `candidate`:
  * `id`
  * `text`
  * `urls`
  * `topicTags`
  * `evidenceIds`
* `context`:
  * `evaluatedAt`
  * `postedTodayCount`
  * `lastPostedAt`
  * monthly spend / request usage
  * estimated spend / request usage for this candidate

## Outputs

输出 `AutomationPolicyDecision`：

* `outcome`: `auto_post` / `human_review` / `reject` / `defer`
* `route`: `x_official_auto` / `telegram_human_gate` / `blocked` / `deferred`
* `requiresHumanReview`
* `canAutoPost`
* `hasLink`
* `reasons`
* `checks`

## Rules

### Auto-post

候选帖可以自动发的必要条件：

* 账号 enabled。
* 账号 `real_posting_enabled` 为 true。
* 文本非空且不超过当前 policy 的自动发帖 plain text 限制。
* 不含链接。
* 不命中账号 `style.banned_phrases` 或硬编码 debug/test 痕迹。
* 命中至少一个账号 include topic。
* 不命中账号 exclude topic。
* 账号没有 `posting.require_approval`。
* 未超过 daily max。
* cooldown 已结束。
* projected budget / request usage 未超过账号 cap。

### Topic Matching

账号 topic 匹配必须保守：

* `topicTags` 使用归一化后的精确匹配。
* 正文中的 ASCII topic 只能按词或短语边界匹配，不能用裸 substring。
* 账号 topic `AI` 不能匹配 `daily`、`said` 这类包含 `ai` 字母序列但语义无关的词。

### Human Review

候选帖进入人工 gate 的条件：

* 含链接。
* 超过自动发帖 plain text 限制的长帖。
* 或账号策略要求 approval。

本 task 只输出 `human_review` 和 `telegram_human_gate`，不发送 Telegram。

### Reject

候选帖被拒绝的条件：

* 账号 disabled。
* 命中 banned/debug/test phrase。
* 命中 exclude topic。
* 未命中任何 include topic。

### Defer

候选帖被延后的条件：

* real posting 未启用。
* daily max 已满。
* cooldown 未结束。
* budget / request cap 会被突破。

## Ledger

`recordAutomationPolicyDecision` 必须写入：

* `ai_decisions`
  * `decision_type = automation_policy`
  * `outcome` 等于 policy outcome
  * `requires_human_review`
  * `rationale_json` 包含 route、reasons、checks
* `audit_events`
  * `event_type = automation_policy_decided`
  * `subject_type = ai_decision`
  * `subject_id = decision id`

这两个写入必须是原子的。若 `audit_events` 写入失败，例如 event id 重复，已经写入的 `ai_decisions` 必须回滚，不能留下半条 policy ledger。

repo 层继续负责 `account_uuid` 归属校验；如果试图把某个账号的 policy decision 记录到另一个账号的 AI run，必须失败。

## Acceptance

离线测试必须证明：

* 无链接合规候选帖输出 `auto_post`。
* 带链接候选帖输出 `human_review` 和 `telegram_human_gate`。
* 超过自动发帖长度的长帖输出 `human_review` 和 `telegram_human_gate`，不自动发。
* `daily` 等普通英文词不能因为包含 `ai` 而命中账号 topic `AI`。
* excluded topic / debug test 文案输出 `reject`。
* daily max / budget guard 输出 `defer`。
* policy decision 能写入 `.004` ledger，并按 `account_uuid` 隔离。
* policy decision + audit event 写入失败时必须回滚。
* 跨账号记录 policy decision 会被拒绝。
