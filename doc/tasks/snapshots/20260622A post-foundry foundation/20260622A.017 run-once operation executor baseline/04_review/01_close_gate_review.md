# Close Gate Review

## Result

已收口，Close Gate 通过。

## What Landed

* `src/lib/orchestration/run-once-operation-executor.ts`
  * `createFixtureRunOnceOperationExecutor`
  * fixture modes: `auto_post`、`human_review_link`、`draft_blocked`、`reject`
  * account config seed + config snapshot
  * prompt hash only; prompt 明文不写入 ledger
  * `.013` offline orchestration reuse
  * account mismatch 写 ledger 前拒绝
* `src/cli/run-once-online.ts`
  * 保持 production entrypoint 语义。
  * 当前只返回 `production operation executor is not wired yet`。
  * 不打开默认 runtime DB，不写 fixture ledger。
* `src/cli/run-loop-online.ts`
  * 保持 production loop entrypoint 语义。
  * 当前复用 `.016` loop runner，但 operation 是 production `not_wired`。
  * 不打开默认 runtime DB，不写 fixture ledger。
* `src/cli/debug-run-once-offline-fixture.ts`
  * 显式 offline fixture debug 入口。
  * 必须传 `--db-file`，只写用户指定的测试库。
* `tests/run-once-operation-executor-offline.test.ts`
  * once full trace + ledger
  * prompt 明文不落 `ai_runs`
  * link draft -> fake Telegram ledger
  * draft gate blocked before policy
  * reject -> policy terminal noop
  * account mismatch no ledger write
  * offline fixture debug CLI args: requires `--db-file` and rejects invalid `--mode`
  * loop reuse with two unique traces
* `package.json` / `justfile` 增加 `test-run-once-operation-executor-offline`。
* `justfile` 增加 `debug-run-once-offline-fixture`。
* task index 增加 `.017`。

## Verification

* `just test-run-once-operation-executor-offline`: passed, 8 tests.
* `just test-online-runner-offline`: passed, 9 tests.
* `just check`: passed.
* `just test`: passed, 17 files / 124 tests.
* `git diff --check`: passed.

## Online Runs

未执行在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth、新闻抓取、网页登录、MCP 浏览器、Playwright、`run-once-online`、`run-loop-online` 或真实发帖。

## Residual Risk

`.017` 仍然只有 fixture executor，不代表真实 source collection、真实 LLM 草稿、真实 Telegram 通知或真实 X 发帖已经接入。后续真实生产 executor 接入时必须继续复用 `.016` runner 和本任务的 executor 边界，并保留同账号锁和完整 ledger 追踪。
