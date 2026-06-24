# Close Gate Review

## Result

已收口，Close Gate 通过。

## What Landed

* `src/lib/llm/draft-adapter.ts`
  * `buildDraftLlmRequest`
  * `runOfflineDraftLlmAdapter`
  * `recordDraftLlmAdapterRun`
  * offline fixture provider boundary
  * prompt-safe request contract
  * compact account memory context
  * strict adapter result runtime sanitize before ledger write
* `tests/llm-draft-adapter-offline.test.ts`
  * prompt plaintext exclusion
  * offline provider request capture
  * `.009` draft parser integration
  * invalid provider output rejection
  * non-offline provider rejection
  * cross-account memory rejection
  * tampered adapter result rejection before ledger write, including raw output hash, provider identity, draft id, usage extra fields, and topic mismatch
  * ledger write without prompt plaintext
* `package.json` / `justfile` 增加 `test-llm-draft-adapter-offline`。
* task index 增加 `.015`。

## Verification

* `just test-llm-draft-adapter-offline`: passed.
* `just check`: passed.
* `just test`: passed.
* `git diff --check`: passed.

## Online Runs

未执行在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth、新闻抓取、网页登录或真实发帖。

## Residual Risk

`.015` 仍是离线 fake LLM adapter boundary，不代表真实模型质量、成本、延迟或 provider failure semantics 已验证。后续接真实 LLM 时，必须保留本任务的 prompt 明文保护、离线/在线入口分层、ledger 摘要写入和用户明确授权在线运行的规则。
