# Close Gate Review

## Result

Close Gate 通过。

## What Landed

* Production once/loop entrypoints now run a local-only preflight before opening the runtime DB.
* Preflight rejects disabled launch config, missing source keywords/cap, missing credentials, placeholder credentials, missing prompt, and disabled account real posting.
* Startup failures while reading local config/secrets/account/prompt are normalized to `stage: production_preflight` before DB open or provider construction.
* Placeholder secrets such as `replace-with-*`, `optional-*`, and `@replace_*` are treated as absent by credential resolution.
* Optional account-level TwitterAPI.io placeholder no longer overrides a real global TwitterAPI.io key.
* justfile production comments now state that production entries may auto-post when account policy allows it.
* V0 operator runbook is documented with just native argument style.

## Verification

* `just test-offline-api`: passed, 23 tests.
* `just test-offline-production-run-once`: passed, 9 tests.
* `just check`: passed.
* `just test`: passed, 20 test files / 149 tests.
* `just --list`: passed; production comments use production-entrypoint wording without an extra env guard.
* `git diff --check`: passed.

## Online Runs

未执行 TwitterAPI.io、真实 Codex model call、X official API、OAuth、Telegram、新闻抓取、网页登录、MCP 浏览器、Playwright、`prod-online-run-once`、`prod-online-run-loop` 或真实发帖。

## Residual Risk

Preflight only proves local configuration is present and not obviously placeholder-shaped. It does not verify token validity or provider account permissions, because that would require online calls and must remain a user-triggered production/debug action.
