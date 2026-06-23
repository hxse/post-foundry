# Audit Event Ledger Baseline Spec

## Principles

1. `account_uuid` 是所有运营审计数据的归属真值。
2. AI 自动化默认可以继续推进，但不能绕过审计写入。
3. 决策和副作用分离：AI decision 记录理由和证据，action 记录实际尝试或执行。
4. 链接帖后续进入 Telegram human gate；本 task 只提供 `human_reviews` 表和 repo API，不实现 bot。
5. 在线 API、OAuth、真实发帖和第三方在线读回不能进入 `.004` 自动测试。

## Tables

### `audit_events`

通用事件总账，记录任何可审计事件：

* `account_uuid`
* `event_type`
* `subject_type`
* `subject_id`
* `actor_type`: `ai` / `system` / `human` / `provider`
* `actor_id`
* `trace_id`
* `occurred_at`
* `metadata_json`

### `ai_runs`

记录每一次 AI 运行：

* `account_uuid`
* `job_id`
* `trace_id`
* `purpose`
* `model`
* `status`
* `started_at`
* `finished_at`
* `input_hash`
* `input_json`
* `output_json`
* `error`

`input_hash` 用稳定 JSON hash 生成，便于不读取全文时比对输入一致性。

### `ai_decisions`

记录 AI 的结构化判断：

* `account_uuid`
* `ai_run_id`
* `decision_type`
* `outcome`: `auto_post` / `human_review` / `reject` / `defer`
* `confidence`
* `requires_human_review`
* `rationale_json`
* `created_at`

后续 policy engine 会把“无链接普通帖自动发”和“带链接帖 Telegram 审批”落成 decision outcome。

### `ai_actions`

记录 AI 或系统尝试执行的动作：

* `account_uuid`
* `ai_run_id`
* `decision_id`
* `action_type`
* `status`
* `started_at`
* `finished_at`
* `input_json`
* `output_json`
* `error`

action 必须至少关联 `ai_run_id` 或 `decision_id`。

### `evidence_refs`

记录 AI 决策引用的证据：

* `account_uuid`
* `ai_run_id`
* `decision_id`
* `source_type`
* `provider`
* `source_ref`
* `source_url`
* `title`
* `captured_at`
* `metadata_json`

证据必须至少关联 `ai_run_id` 或 `decision_id`。

### `human_reviews`

记录人工 gate：

* `account_uuid`
* `decision_id`
* `action_id`
* `channel`: `telegram` / `local_cli` / `manual`
* `external_message_id`
* `reviewer_actor`
* `outcome`: `approved` / `rejected` / `edited`
* `reviewed_at`
* `note`
* `payload_json`

human review 必须至少关联 `decision_id` 或 `action_id`。

## Repository Requirements

repo 写入 API 必须：

* 校验 `account_uuid` 是 UUID。
* 校验所有时间字段是 ISO datetime。
* 校验 actor、trace、subject、type 等关键字段非空。
* 校验 `confidence` 在 `[0, 1]`。
* 校验 actor type、status、decision outcome、evidence source type、human review channel 和 human review outcome 是允许枚举值。
* 校验被引用的 job / run / decision / action 存在。
* 校验被引用对象的 `account_uuid` 和当前记录一致。
* 拒绝跨账号把 decision 挂到另一个账号的 run 上。
* 拒绝把同账号内无关的 decision 和 action 绑到同一条 human review 上；如果 action 没有直接挂 `decision_id`，则它的 `ai_run_id` 必须和 decision 的 `ai_run_id` 一致。

## Runtime Health

`runtime-health` 输出必须包含审计表计数：

* `audit_events`
* `ai_runs`
* `ai_decisions`
* `ai_actions`
* `evidence_refs`
* `human_reviews`

## Acceptance

离线测试必须证明：

* migration `0002_audit_event_ledger_baseline` 可以幂等应用。
* 一个账号的 AI run / decision / evidence / action / human review / audit event 可以完整写入。
* 另一个账号默认读不到这些记录。
* 跨账号引用会被 repo 拒绝。
* 同账号内不相关的 decision / action human review 绑定会被拒绝。
* 非法时间、空 actor、非法 confidence、非法枚举值、缺少 causal link 会被拒绝。
