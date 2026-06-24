# Close Gate Review

## Result

已收口，Close Gate 通过。

## What Landed

* `src/lib/orchestration/production-source-collection-executor.ts`
  * production source collection executor
  * account mismatch rejection before side effects
  * registry account / X identity upsert
  * account config snapshot save
  * `.018` `collectAccountPublicXSourceBatch` integration
  * source-only result summary without source text bodies
* `src/lib/orchestration/production-runner-args.ts`
  * shared once/loop production CLI parser
  * `--config-file` required for production online runs
  * `config/accounts.example.json` rejected by resolved path
  * source query / per-query limits capped at 10
* `src/cli/run-once-online.ts`
  * `prod-online-run-once` now runs production source collection instead of skipped executor
  * opens runtime DB, reads account registry/secrets, constructs TwitterAPI.io adapter
* `src/cli/run-loop-online.ts`
  * `prod-online-run-loop` reuses the same production source collection executor
  * loop remains scheduler-only around once runner
* `src/lib/orchestration/online-runner.ts`
  * internal entrypoint names now match canonical `prod-online-run-once` / `prod-online-run-loop`
* `tests/production-run-once-offline.test.ts`
  * production CLI guardrails
  * source collection through once runner with fake provider
  * monthly cap skip without provider call
  * account mismatch rejection
* `package.json` / `justfile`
  * `test:production-run-once-offline`
  * `just test-offline-production-run-once`
  * production just comments now state real source collection behavior
* task index adds `.019`.

## Verification

* `just test-offline-production-run-once`: passed, 4 tests.
* `just check`: passed.
* `just test`: passed, 19 files / 134 tests.
* `just --list`: passed.
* `git diff --check`: passed.

## Online Runs

未执行 TwitterAPI.io、X official API、OAuth、Telegram、新闻抓取、网页登录、MCP 浏览器、Playwright、`prod-online-run-once`、`prod-online-run-loop` 或真实发帖。

## Residual Risk

`.019` 只接 production source collection。真实 LLM draft、topic selection from newly collected sources、Telegram notification 和 X official publisher 仍未接入 production runner；后续任务必须继续保持显式人工在线入口和 ledger-first 设计。
