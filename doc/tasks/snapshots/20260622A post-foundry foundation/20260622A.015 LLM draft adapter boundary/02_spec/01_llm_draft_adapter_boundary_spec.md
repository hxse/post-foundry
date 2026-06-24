# LLM Draft Adapter Boundary Spec

## Request Contract

`buildDraftLlmRequest` 必须从 `.009` `DraftRunInputPackage` 和可选 `.014` `AccountMemorySnapshot` 构造 `llm_draft_request_v1`。

request 可以包含：

* account uuid/key/language/config version/config hash/config snapshot id
* 账号结构化 topics/style
* prompt source、prompt hash、prompt path
* selected topic
* source materials 摘要
* recent posts
* compact memory：memory hash、recent outcome counts、compact lifetime stats、top topic hints、recent trace hints、next run hints
* guardrails

request 不得包含：

* prompt 明文
* secrets
* OAuth token、refresh token、API key、client secret
* 完整历史 trace 明细
* post text 明文历史全集
* browser/cookie/proxy/login 信息

如果传入 memory 的 account uuid/key 和 input package 不一致，必须在 provider 调用前拒绝。

## Provider Boundary

`.015` 只允许 `mode = offline_fixture` 的 fake provider。任何非 offline mode 都必须在调用 provider 前拒绝。

provider 输出必须交给 `.009` `parseAiPostingDraftOutput` 解析。未知 evidence id、跨账号 draft、格式错误或 schema 不合法输出必须被拒绝，不能进入 policy 或 executor。

## Ledger

`recordDraftLlmAdapterRun` 必须在 transaction 中写入：

* `ai_runs`: purpose `llm_draft_generation`
* `audit_events`: event type `llm_draft_generated`

ledger input 可以保存 provider identity 和 sanitized request。ledger output 只能保存 draft id、topic id、post text hash、urls、topic tags、evidence ids、raw output hash 和 usage 摘要。

`recordDraftLlmAdapterRun` 在开启 transaction 前必须严格解析整个 `DraftLlmAdapterResult`：`rawOutputSha256` 必须是 64 位 sha256，`usage` 只允许非负 `inputTokens`、`outputTokens`、`costUsd` 字段，draft id、topic tags 和 evidence ids 必须是紧凑 token，urls 必须是合法 URL，post text 必须满足 `.009` schema 长度上限。任何 result 污染或 schema 失败都必须在写 ledger 前拒绝。

不得把 prompt 明文、secrets 或完整 post text 明文写入 ledger。

## Offline Test Entry

必须提供 focused 离线命令：

* `just test-llm-draft-adapter-offline`

默认 `just test` 可以包含此离线测试。任何在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth、新闻抓取、网页登录或真实发帖都不得进入该任务验证。
