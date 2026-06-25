# Close Gate Review

## Result

Close Gate 通过。

## What Landed

* Production auto-post now performs third-party readback through `PublicXDataProvider.getPostById` after X official returns a tweet id.
* Confirmed readback records `public_x_post_readback` API audit, `public_x_post` evidence ref, `x_post_readback_confirmed` audit event, text hash comparison and compact metrics.
* Missing or failed readback records audit state without failing the already-succeeded X post action.
* Account memory now exposes per-trace `performance` with readback status and compact metrics.
* Public X monthly request accounting now counts all TwitterAPI.io audit rows, including readback.
* Auto-post policy evaluation reserves one public X request for readback before X official posting.

## Verification

* `just test-offline-production-operation`: passed, 10 tests.
* `just test-offline-account-memory`: passed, 3 tests.
* `just test-offline-source-collection`: passed, 6 tests.
* `just check`: passed.
* `just test`: passed, 20 test files / 145 tests.
* `just --list`: passed; entrypoint naming remains unchanged.
* `git diff --check`: passed.

## Online Runs

未执行 TwitterAPI.io、OpenAI、X official API、OAuth、Telegram、新闻抓取、网页登录、MCP 浏览器、Playwright、`prod-online-run-once`、`prod-online-run-loop` 或真实发帖。

## Residual Risk

V0 records not_found/failed readback but does not yet provide a retry command for delayed provider indexing. If the provider has not indexed a real post during online operation, the ledger will preserve the residual risk for later retry or manual operator review without using `x.com` browser fallback.
