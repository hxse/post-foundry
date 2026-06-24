# V0 Production Operation Loop Spec

## Production Contract

`prod-online-run-once` 和 `prod-online-run-loop` 必须复用同一个 production executor。一次 operation 的顺序是：

1. `.018` source collection through TwitterAPI.io public X provider。
2. source skipped / empty 时停止，不加载 prompt、不调用 LLM、不发 Telegram、不发 X。
3. 读取 account memory 作为紧凑历史上下文。
4. 加载 account initial prompt。
5. `.012` topic radar selection。
6. `.010` source context ingestion。
7. LLM draft generation。
8. `.009` draft parsing + draft gate。
9. `.005` automation policy。
10. final action：
    * `auto_post` -> X official API create post。
    * `human_review` -> Telegram notification。
    * `reject/defer` -> policy terminal noop。
    * draft gate blocked -> draft gate blocked noop。

## Provider Boundaries

* Public X read: only through `PublicXDataProvider` / TwitterAPI.io adapter.
* LLM draft: through OpenAI Responses API provider or injected fake provider in offline tests.
* X write: only through X official API publisher.
* Manual notification: only through Telegram Bot API notifier.
* No browser, MCP browser, Playwright, `x.com` page access, cookie, login state or anti-detect automation.

## Ledger Contract

The production loop must write a single trace containing:

* `public_x_source_collection` AI run and API audit.
* `topic_radar_selection` AI run and `topic_selected` audit event.
* `source_context_ingestion` AI run and source evidence refs.
* `ai_posting_draft` AI run.
* `automation_policy` AI run and `automation_policy` decision when draft gate passes.
* exactly one final action for X auto post, Telegram notification, terminal noop, or draft gate blocked.

Prompt plaintext must not be written to runtime ledger. Ledger may store prompt hash, source material ids, post text hash, provider response id, usage metadata and final provider ids.

## Safety Contract

* The production loop may decide not to post.
* X official real posting still requires `POST_FOUNDRY_ALLOW_REAL_X_POST=1` inside the X publisher.
* Account `posting.real_posting_enabled` must pass policy before X auto post.
* Linked or over-280-character drafts route to Telegram human notification.
* Online/cost-bearing commands are manual only; default tests must stay offline.
* V0 does not implement dollar-cost budgeting; OpenAI usage is stored as token metadata, and TwitterAPI.io is guarded by request-count caps.

## Acceptance

Focused offline tests must prove:

* auto-post branch records source/topic/context/draft/policy/X action in one trace with fake providers.
* link branch records Telegram notification and does not call X poster.
* formatted draft is blocked before policy and final providers.
* source skipped / empty stops before prompt loading, LLM, Telegram and X providers.
* prompt plaintext is absent from stored AI runs.
* OpenAI/TwitterAPI.io API audit rows are recorded by provider and operation.
