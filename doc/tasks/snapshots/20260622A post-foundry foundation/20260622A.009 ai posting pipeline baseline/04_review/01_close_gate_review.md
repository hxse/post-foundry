# Close Gate Review

## Result

Close Gate 通过。

## What Landed

* `src/lib/drafts/ai-posting-pipeline.ts`：
  * `createDraftRunInputPackage`
  * `parseAiPostingDraftOutput`
  * `evaluateDraftForPosting`
  * `checkRecentPostDuplication`
  * `recordDraftRun`
  * draft gate 复用 `findRealDebugPostTextViolation`，与真实发帖保护策略保持一致。
  * `recordDraftRun` 写 ledger 前重新构造 sanitized input package，丢弃 contract 外字段。
* `tests/ai-posting-pipeline-offline.test.ts` 覆盖 input package、自然发帖文本、长帖进入 Telegram human gate、极端超长文本拦截、格式化/debug 拦截、真实发帖 debug marker 复用、近期重复检测、policy schema 消费、evidence id 校验和 ledger 写入净化。
* `package.json` / `justfile` 增加 `test-ai-posting-pipeline-offline`。
* task index 增加 `.009`。

## Verification

* `just test-ai-posting-pipeline-offline`: passed.
* `just check`: passed.
* `just test`: passed.
* `git diff --check`: passed.

## Online Runs

未执行在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth 或真实发帖。本任务只做离线 draft pipeline baseline。

## Residual Risk

近期重复检测当前是 v0 启发式，只能拦截明显重复。后续接真实运行时，应补 embedding 或 LLM-based semantic dedupe，并把重复判断本身写入 ledger。
