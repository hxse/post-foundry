# Close Gate Review

Close Gate passed on 2026-06-25 after account-level Codex session reuse, one-time prompt, and opt-in session age reset changes.

## Accepted Scope

* Production once/loop entrypoints wire `CodexCliDraftGenerator` instead of the OpenAI API draft provider.
* `secrets/accounts.local.example.json` no longer contains OpenAI API key, model, or base URL configuration.
* Production preflight requires a local Codex CLI version/login-status check before opening the runtime DB or calling TwitterAPI.io/X/Telegram/model generation.
* Production once/loop entrypoints print operator-visible progress logs for preflight, Codex runtime checks, DB open, lock handling, source collection, draft generation, policy, and final action stages. The just recipes suppress noisy shell command echo.
* Draft generation uses `codex --ask-for-approval never --search exec --json --sandbox read-only --output-schema ...` with the prompt payload on stdin.
* Draft generation captures Codex JSONL `thread.started.thread_id` and stores only account/session metadata under `data/codex-sessions`.
* Same-account once and loop runs reuse the stored Codex session by default through `codex exec resume <thread_id>`.
* Stored account Codex session ids do not expire by default; `--codex-session-max-age-hours` enables opt-in age reset.
* `just local-codex-reset-session --account ...` explicitly forgets the stored account session id so the next production draft opens a new Codex session.
* `prod-online-run-once --one-time-prompt ...` injects a temporary operator hint into that run only; loop does not accept this flag.
* Runtime ledger records draft audit provider `codex` and keeps prompt plaintext out of stored AI runs. One-time prompts are recorded by hash where needed.
* Default tests use fake Codex exec runners; no real Codex model call is part of Close Gate.

## Verification

* `nix shell nixpkgs#nodejs --command just test-offline-codex-draft-generator`: passed, 9 tests.
* `nix shell nixpkgs#nodejs --command just test-offline-production-run-once`: passed, 9 tests.
* `nix shell nixpkgs#nodejs --command just test-offline-production-operation`: passed, 10 tests.
* `nix shell nixpkgs#nodejs --command just check`: passed.
* `nix shell nixpkgs#nodejs --command just test`: passed, 21 test files / 159 tests.
* `git diff --check`: passed.
* `just --dry-run prod-online-run-once --account zh-tech --one-time-prompt "临时选题方向：BTC ETF"`: passed; no command executed.
* `just --dry-run prod-online-run-loop --account zh-tech --max-iterations 1`: passed; no command executed.
* `just --dry-run prod-online-run-once --account zh-tech --codex-session-max-age-hours 72`: passed; no command executed.
* `just --dry-run local-codex-reset-session --account zh-tech`: passed; no command executed.

## Online Runs

Not executed: real Codex model call, `prod-online-run-once`, `prod-online-run-loop`, TwitterAPI.io, X official API, OAuth, Telegram, browser automation, MCP browser, Playwright, or `x.com`.

## Residual Risk

The provider is verified with fake Codex exec runners only. A real production trial still requires the operator to run `just local-codex-status` and then manually run `prod-online-run-once` when ready.
