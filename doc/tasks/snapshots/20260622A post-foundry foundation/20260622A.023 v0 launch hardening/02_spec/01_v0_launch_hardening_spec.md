# V0 Launch Hardening Spec

## Production Preflight

`prod-online-run-once` and `prod-online-run-loop` must run a local-only preflight before opening the runtime SQLite DB or constructing real provider clients. The preflight may read local config, local secrets and the local account prompt, but it must not call OpenAI, TwitterAPI.io, X official API, Telegram, news sites, browsers, MCP browser, Playwright, or `x.com`.

Preflight must require:

* account exists and is enabled;
* public X source collection is enabled;
* public X search keywords are configured;
* public X monthly request cap is greater than 0;
* `posting.real_posting_enabled` is true for v0 launch runs;
* usable TwitterAPI.io API key;
* usable OpenAI API key;
* usable X official access token;
* usable Telegram bot token and notification channel;
* `POST_FOUNDRY_ALLOW_REAL_X_POST=1`;
* account initial prompt loads from local secrets and exposes a prompt sha256.

Placeholder values from example files such as `replace-with-*`, `optional-*`, and `@replace_*` are not usable credentials. An optional account-level placeholder must not override a real global provider key.

If preflight fails, the command must print a redacted local `ApiError` with stage `production_preflight`. It must not open the runtime DB or call any external provider.

## Operator Runbook

Initial local setup:

```bash
just local-init-secrets
```

Fill ignored local files only:

* `config/accounts.local.json` for real non-secret account config, including `posting.real_posting_enabled: true`;
* `secrets/accounts.local.json` for TwitterAPI.io, OpenAI, Telegram, X official token, and account prompt reference;
* optional prompt markdown under `secrets/prompts/*.md`.

Run one production cycle manually:

```bash
POST_FOUNDRY_ALLOW_REAL_X_POST=1 just prod-online-run-once --account zh-tech --config-file config/accounts.local.json
```

Run a loop manually only after a successful one-shot trial:

```bash
POST_FOUNDRY_ALLOW_REAL_X_POST=1 just prod-online-run-loop --account zh-tech --config-file config/accounts.local.json --interval-seconds 28800 --jitter-seconds 600 --sleep-utc 16:00-00:00
```

Stop a foreground loop with Ctrl-C. If running under a process manager later, stop it through that process manager. Same-account once and loop commands share the account lock; one waits for the other instead of running concurrently.

Inspect local runtime state without calling external APIs:

```bash
just local-runtime-health
```

## Boundaries

Default validation remains offline only: `just check`, `just test`, and focused `test-offline-*` commands. Agent Close Gate must not run production, online debug, OAuth, OpenAI, TwitterAPI.io, Telegram, X official API, real posting, browser automation, or `x.com`.

If a production run posts successfully, readback verification must use TwitterAPI.io by tweet id. Browser fallback to `x.com` remains forbidden.
