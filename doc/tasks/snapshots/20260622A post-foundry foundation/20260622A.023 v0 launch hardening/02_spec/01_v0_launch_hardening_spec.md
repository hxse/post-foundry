# V0 Launch Hardening Spec

## Production Preflight

`prod-online-run-once` and `prod-online-run-loop` must run a local-only preflight before opening the runtime SQLite DB or constructing real provider clients. The preflight may read local config, local secrets and the local account prompt, but it must not call Codex model generation, TwitterAPI.io, X official API, Telegram, news sites, browsers, MCP browser, Playwright, or `x.com`.

Preflight must require:

* account exists and is enabled;
* public X source collection is enabled;
* account initial prompt can derive at least one public X source query;
* public X per-run source request cap is greater than 0;
* `posting.real_posting_enabled` is true for v0 launch runs;
* usable TwitterAPI.io API key;
* local Codex CLI is installed and logged in;
* no OpenAI API key is required for draft generation;
* usable X official access token;
* usable Telegram bot token and notification channel;
* account initial prompt loads from local secrets and exposes a prompt sha256.

Placeholder values from example files such as `replace-with-*`, `optional-*`, and `@replace_*` are not usable credentials. An optional account-level placeholder must not override a real global provider key.

If preflight fails, the command must print a redacted local `ApiError` with stage `production_preflight`. It must not open the runtime DB or call any external provider.

## Operator Runbook

Initial local setup:

```bash
just local-init-secrets
```

Fill ignored local files only:

* `secrets/accounts.local.json` for provider credentials, account prompt reference, and profile reference;
* ignored profile JSON under `secrets/profiles/*.json`, including `posting.real_posting_enabled: true` and `source.max_requests_per_run`;
* prompt markdown under `secrets/prompts/*.md`.

Run one production cycle manually:

```bash
just prod-online-run-once --account zh-tech
```

Run a loop manually only after a successful one-shot trial:

```bash
just prod-online-run-loop --account zh-tech --interval-seconds 28800 --jitter-seconds 600 --sleep-utc 16:00-00:00
```

Stop a foreground loop with Ctrl-C. If running under a process manager later, stop it through that process manager. Same-account once and loop commands share the account lock; one waits for the other instead of running concurrently.

Inspect local runtime state without calling external APIs:

```bash
just local-runtime-health
```

## Boundaries

Default validation remains offline only: `just check`, `just test`, and focused `test-offline-*` commands. Agent Close Gate must not run production, online debug, OAuth, real Codex model calls, TwitterAPI.io, Telegram, X official API, real posting, browser automation, or `x.com`.

If a production run posts successfully, readback verification must use TwitterAPI.io by tweet id. Browser fallback to `x.com` remains forbidden.
