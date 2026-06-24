# Close Gate Review

## Result

已收口，Close Gate 通过。

## What Landed

* `src/lib/orchestration/online-runner.ts`
  * `runOnlineOperationOnce`
  * `runOnlineOperationLoop`
  * account-scoped lock acquire/release
  * atomic hard-link lock creation with complete JSON
  * stale/corrupt lock cleanup
  * heartbeat sidecar refresh without lock resurrection
  * UTC sleep window parsing
  * minimum loop interval enforcement: `300` seconds
  * interval jitter calculation
* `src/cli/run-once-online.ts`
* `src/cli/run-loop-online.ts`
* `tests/online-runner-offline.test.ts`
  * once lock/release
  * complete JSON lock content while running
  * concurrent same-account serialization
  * corrupt lock cleanup
  * stale lock cleanup
  * heartbeat sidecar cleanup without lock resurrection
  * loop reuses once runner
  * UTC sleep window
  * deterministic jitter
  * 300-second minimum loop interval
* `package.json` / `justfile` 增加 `test-online-runner-offline`。
* `justfile` 增加手动在线入口：`run-once-online`、`run-loop-online`。
* task index 增加 `.016`。

## Verification

* `just test-online-runner-offline`: passed, 9 tests.
* `just check`: passed.
* `just test`: passed, 16 files / 116 tests.
* `git diff --check`: passed.

## Online Runs

未执行在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth、新闻抓取、网页登录或真实发帖。

## Residual Risk

`.016` 只落 online runner / lock / loop baseline，CLI 当前接的是 skipped executor，不代表真实 source collection、真实 LLM 草稿、真实 Telegram 或真实 X 发帖已接入。后续任务接真实 provider 时，必须复用本任务的 once runner 和账号级锁。
