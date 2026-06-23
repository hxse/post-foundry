# Source Ingestion Baseline Spec

## Inputs

`buildSourceContext` 输入：

* `account`: `.002` 的 `AccountConfig`
* `topic`: `.009` 的 `CandidateTopic`
* `materials`: source material list
* `recentPosts`: recent account post list
* `collectedAt`
* optional limits

## Source Materials

source material 支持：

* `public_x_post`
* `public_x_search`
* `web_page`
* `manual_note`
* `runtime_snapshot`

字段：

* `id`
* optional `accountUuid`
* `sourceType`
* optional `provider`
* `sourceRef`
* optional `sourceUrl`
* optional `title`
* `summary` or `text`
* `capturedAt`
* optional `topicTags`
* optional `authorHandle`
* optional engagement metrics

如果 material 或 recent post 带 `accountUuid`，必须与当前账号一致，否则拒绝。

## Context Build Rules

`buildSourceContext` 必须：

* 校验所有时间为 ISO datetime。
* 拒绝重复 material id。
* 拒绝重复 recent post id。
* `materialsLimit` / `recentPostsLimit` 如提供，必须是正整数。
* 过滤命中账号 exclude topic 的 materials。
* 按 topic 命中、source type 权重、engagement 和时间排序 materials。
* 按时间倒序裁剪 recent posts。
* 输出 `.009` 可消费的 `materials` 和 `recentPosts`。

如果过滤后没有 material，必须失败。

## Draft Input Integration

`createDraftInputPackageFromSourceContext` 必须验证：

* source context 的 `accountUuid` 与 account 一致。
* source context 的 `accountKey` 与 account 一致。
* 输出能直接作为 `.009` `DraftRunInputPackage` 使用。

## Ledger

`recordSourceContextIngestion` 写入：

* `ai_runs`: purpose `source_context_ingestion`
* `evidence_refs`: 每个入选 material 一条
* `audit_events`: event type `source_context_built`

ledger 中记录 material ids、recent post ids、recent post hashes、material scores 和 context hash。source material summary 可以写入 evidence metadata；不访问外部服务。

手工传入的 source context package 在写 ledger 前必须重新校验，且 material ids 必须与 material score keys 完全对齐；缺少 score 或 score 指向未知 material 都必须失败。

## Acceptance

离线测试必须证明：

* 能从 fixture materials/recentPosts 构建 source context。
* source context 能转成 `.009` draft input package。
* exclude topic materials 会被过滤。
* recent posts 按时间倒序裁剪。
* 跨账号 material/recent post 会失败。
* 重复 material id 会失败。
* 非正整数 limit 会失败。
* 过滤后没有 material 会失败。
* material scores 与 materials 不对齐会失败。
* source context ingestion 会写入 `ai_runs`、`evidence_refs` 和 `audit_events`，并按 `account_uuid` 隔离。

本任务不得执行在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth 或真实发帖。
