# Close Gate Review

## Result

已收口，Close Gate 通过。

## What Landed

* `src/lib/context/source-collection.ts`
  * `collectAccountPublicXSourceBatch`
  * account-scoped public X source collection
  * request cap / enabled guardrails
  * monthly request usage auto-summed from current-month `api_call_audit`
  * per-query API audit through existing TwitterAPI.io adapter
  * dedupe by material id
  * compact AI run output with material hashes, not source text bodies
  * evidence refs and audit event ledger
  * failed provider attempts preserve original provider error
* `src/cli/debug-online-source-collection.ts`
  * manual online debug entrypoint
  * default dry-run
  * `--collect` required for TwitterAPI.io network access and ledger writes
  * supports `--secrets-file`, `--db-file`, `--max-requests`, `--per-query-limit`; .024 removed `--config-file`
  * `--collect` requires explicit `--config-file`; example config is dry-run only
* `tests/source-collection-offline.test.ts`
  * success ledger path
  * request cap skipped path from existing `api_call_audit`
  * online source collection CLI parser guardrails
  * provider failure path
  * invalid limit preflight
* `package.json` 增加 `test:source-collection-offline`，并删除 online/debug/token/runtime 人工入口 scripts；人工入口只由 `justfile` 暴露。
* `justfile` 增加 canonical `test-offline-source-collection`。
* `justfile` 保留 canonical 入口分区，并删除旧 compatibility/deprecated recipe，避免在线、离线、生产入口命名混淆。
* `justfile` 分区标注 offline tests、local tools、offline debug、online debug 和 prod online entrypoints。
* task index 增加 `.018`。

## Verification

* `just test-offline-source-collection`: passed, 6 tests.
* `just check`: passed.
* `just test`: passed, 18 files / 130 tests.
* `just --list`: passed.
* `git diff --check`: passed.

## Online Runs

未执行 TwitterAPI.io、X official API、OAuth、Telegram、新闻抓取、网页登录、MCP 浏览器、Playwright、`debug-online-source-collection --collect` 或真实发帖。

## Residual Risk

`.018` 只接 source collection 边界，不代表真实 LLM draft、production run-once executor 或 X official publisher 已接入。后续任务必须把本任务输出接入 topic/source/draft orchestration，并继续保持在线命令手动执行。
