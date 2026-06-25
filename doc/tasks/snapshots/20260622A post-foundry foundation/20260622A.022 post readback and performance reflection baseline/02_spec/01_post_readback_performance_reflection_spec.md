# Post Readback And Performance Reflection Spec

## Production Contract

After `x_official_auto_post` succeeds, the production executor must call `PublicXDataProvider.getPostById(tweetId)` using the configured public X provider. For V0 this provider is TwitterAPI.io.

Readback outcomes:

* `confirmed`: provider returned the tweet. Record API audit, evidence ref, audit event, text hash comparison, and compact public metrics.
* `not_found`: provider returned no tweet. Record succeeded API audit and `x_post_readback_not_found` audit event. Do not fail the X post action.
* `failed`: provider threw. Record failed API audit and `x_post_readback_failed` audit event. Do not fail the X post action.

## Ledger Contract

Confirmed readback must write:

* `api_call_audit`: provider `twitterapi.io`, operation `public_x_post_readback`, status `succeeded`.
* `evidence_refs`: source type `public_x_post`, provider `twitterapi.io`, source ref `tweet:<id>`, linked to the policy decision.
* `audit_events`: `x_post_readback_confirmed`, subject type `ai_action`, subject id equal to the final X action id.

Not-found and failed readback must write audit records without creating evidence refs.

Readback metadata must stay compact. It may include tweet id, author ids/handle, created_at, text sha256, expected text sha256, text match boolean, and engagement metrics. It must not require storing prompt plaintext or opening a web page.

## Memory Contract

`buildAccountMemory` must expose readback state as compact trace performance:

* `readbackStatus`: `confirmed`, `not_found`, or `failed`.
* `tweetId`, provider, captured time.
* text match boolean when available.
* metrics: like/repost/reply/quote/bookmark/view counts when available.

The memory builder must recognize production `x_official_auto_post` as a final action, while keeping legacy offline `x_official_auto_post_planned` support.

## Request Accounting Contract

TwitterAPI.io readback still records an `api_call_audit` row with request units, but .024 removed monthly public X budget policy from V0. Source collection has its own per-run request limit; post readback is an audit/readback step after a successful X official post and must not fall back to browser access.

## Safety Contract

No default test, Close Gate, or agent-initiated validation may call TwitterAPI.io, X official API, Telegram, OpenAI, browser automation, or `x.com`. Online validation is manual-only.
