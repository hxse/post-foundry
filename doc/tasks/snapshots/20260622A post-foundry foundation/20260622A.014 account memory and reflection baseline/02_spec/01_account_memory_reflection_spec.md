# Account Memory Reflection Spec

## Source

`buildAccountMemory` 必须只从同账号 runtime ledger 派生 memory：

* `ai_runs`
* `ai_decisions`
* `ai_actions`
* `audit_events`
* `evidence_refs`

不得读取 secrets、prompt 明文、在线服务或其他账号数据。

## Memory Snapshot

`AccountMemorySnapshot` 必须包含：

* `kind = account_memory_v1`
* `accountUuid` / `accountKey`
* `capturedAt`
* source counts
* prompt hash 列表
* recent window outcome counts
* recent window action counts
* recent window topic memory
* compact `lifetimeStats`
* recent trace summaries
* next run hints
* guardrails:
  * account scoped
  * ledger derived
  * offline only
  * prompt plaintext forbidden

trace summary 只保留可审计摘要，例如 selected topic、draft text hash、policy outcome、reason codes、final action、evidence ids。不得把 prompt 明文写入 memory。

`traceSummaries` 受 `traceLimit` 限制，默认只保留最近 20 条 trace。`outcomeCounts`、`actionCounts` 和 `topicMemory` 表示这个 recent window 的统计。

`lifetimeStats` 必须从全量同账号 ledger trace 聚合，但只能保存紧凑统计：

* `traceCount`
* `outcomeCounts`
* `actionCounts`
* `topTopics`，最多保留前 20 个 topic

`lifetimeStats` 不得保存全量 trace 明细、evidence 明细、post text、prompt 明文或无限增长的 trace id 列表。

## Reflection

`createAccountReflection` 必须基于 memory 生成 deterministic reflection：

* memory hash
* top topics
* outcome counts
* lessons
* avoid repeating
* next run hints

`.014` 不调用 LLM 生成 reflection；后续真实 AI 复盘必须继续消费同样的 memory contract。

## Ledger

`recordAccountReflection` 必须在 transaction 中写入：

* `ai_runs`: purpose `account_memory_reflection`
* `evidence_refs`: source type `runtime_snapshot`，引用近期 trace
* `audit_events`: event type `account_memory_reflected`

如果 reflection 账号和 memory 不一致，或 reflection 的 `memorySha256` 不匹配，必须在写 ledger 前拒绝。
如果调用方篡改 deterministic reflection 内容，例如 lessons、summary、topTopics、outcomeCounts 或 nextRunHints，即使 `memorySha256` 没变，也必须在写 ledger 前拒绝。

## Acceptance

离线测试必须证明：

* 从 `.013` 产生的多条 trace 中能构建 account memory。
* memory 包含 auto-post / human-review / reject outcome 统计。
* `traceLimit` 只影响 recent trace summaries，`lifetimeStats` 仍保留全量紧凑统计。
* memory 和 reflection 不包含 prompt 明文，只包含 prompt hash。
* 其他账号不会读到当前账号的 memory。
* reflection 能写入 ledger，并产生 runtime snapshot evidence。
* 篡改 reflection 账号、memory hash 或 deterministic reflection 内容时不会写半条记录。

本任务不得执行在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth、新闻抓取、网页登录或真实发帖。
