# AI Posting Pipeline Baseline Spec

## Pipeline Intent

后续 AI 发帖必须遵循这条顺序：

1. 读取账号配置和账号级初始 prompt。
2. 统计近期已发帖，形成去重上下文。
3. 汇总候选热点，来源可以是公开 X 高赞帖、关注账号动态、新闻、网页资料或人工笔记。
4. 对候选热点重新查资料，形成可追踪的 evidence materials。
5. 生成内部结构化 draft output。
6. 从 draft output 中取唯一外部发帖正文 `post_text`。
7. 在进入 `.005` automation policy 前做自然文本 gate 和近期重复检测。
8. 由 `.005` policy 做自动/人工分流：短帖自动发，超过自动发帖长度的长帖走 Telegram human gate。

## Draft Input Package

`DraftRunInputPackage` 必须包含：

* account:
  * `accountUuid`
  * `accountKey`
  * `configVersion`
  * `configHash`
  * optional `configSnapshotId`
  * language, topics, style
* prompt:
  * `source`
  * `promptSha256`
  * optional `promptPath`
* topic:
  * id, label, reason, keywords
* materials:
  * id, sourceType, provider, sourceRef, optional sourceUrl/title, summary, capturedAt
* recentPosts:
  * id, text, postedAt, source
* guardrails:
  * external post text mode is natural plain text
  * internal structured payload is allowed
  * formatted external post is forbidden
  * evidence ids are required
  * recent duplicate check is required

真实 prompt 明文不能进入 input package。只记录 hash 和来源。

## Draft Output

AI draft output 使用结构化对象：

* `draft_id`
* `post_text`
* `urls`
* `topic_tags`
* `evidence_ids`
* `internal_notes`

`internal_notes` 可以格式化；`post_text` 不可以格式化。`post_text` 是唯一候选外部正文，但只有 `.005` policy 判定为 `auto_post` 的短帖才允许交给 X official API；长帖进入 Telegram human gate。

## External Post Text Gate

`post_text` 必须：

* 长度不超过人工 review 上限；超过自动发帖长度的长帖可以进入 `.005` policy，由 policy 路由到 Telegram human gate。
* 像自然 plain text。
* 不包含 Markdown 标题、列表、引用、代码块、粗体标记或报告式字段。
* 不包含真实发帖保护策略已经定义的测试/调试痕迹，包括 `PostFoundry`、`smoke test`、`test/testing`、`debug/debugging`、`dry-run`、裸 task id、`.009`、中文“测试/调试/验收/验证”等。

格式化内容应留在 ledger、internal notes 或 Telegram review text，不能直接发到 X。

## Recent Duplicate Gate

在 policy 前必须检查本账号近期发帖：

* 归一化文本完全相同视为重复。
* 字符 bigram Jaccard 相似度超过阈值视为明显重复。
* 重复 draft 返回 `blocked`，不得交给 `.005` policy。

这是 v0 离线启发式，不替代后续更强的 embedding/LLM 语义重复检测。

## Ledger

成功 draft run 写入：

* `ai_runs`: purpose `ai_posting_draft`
* `evidence_refs`: 仅写 draft 实际引用的 materials
* `audit_events`: event type `ai_draft_created`

`ai_runs.input_json` 不能包含 prompt 明文，只能包含 `promptSha256`。
`recordDraftRun` 写入前必须重新构造可写入的 sanitized input package，只保留 contract 允许的字段，避免被污染的调用方把 prompt 明文或临时字段写入 ledger。

## Acceptance

离线测试必须证明：

* input package 包含 account config hash、prompt hash、materials 和 recent posts，但不包含 prompt 明文。
* 自然 `post_text` 能转成 `.005` policy 可消费的 `PostingCandidate`。
* 超过自动发帖长度但未超过人工 review 上限的长帖能进入 `.005` policy，并被路由到 Telegram human gate。
* 超过人工 review 上限的极端长 draft 会被 `evaluateDraftForPosting` 拦截。
* Markdown/列表/报告式/debug 文案会在 policy 前被拦截。
* draft gate 复用真实发帖保护策略，覆盖 dry-run、裸 `.009`、test/testing 和中文测试/调试/验收文案。
* 明显重复近期帖会被拦截。
* ready candidate 能被 `.005` automation policy schema 消费。
* draft 引用不存在的 evidence id 会失败。
* draft run 写入 ledger，并且 `ai_runs.input_json` 在正常和污染 input package 下都不包含 prompt 明文。

本任务不得执行在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth 或真实发帖。
