# Codex Draft Runtime Spec

## Runtime Contract

* Production once/loop entrypoints must use the local Codex CLI draft generator, not an OpenAI API-key draft provider.
* `secrets/accounts.local.example.json` must not ask for OpenAI API keys, OpenAI model names, or OpenAI base URLs.
* The production preflight must check local Codex availability/login before opening the runtime DB or calling TwitterAPI.io, X official API, Telegram, or any model draft generation.
* Production once/loop entrypoints must emit operator-visible progress logs for startup, preflight, Codex version/login checks, DB open, lock wait/acquire/release, source collection, draft generation, policy, and final action stages.
* Codex auth setup is operator-managed through `just local-codex-login`; the code must not copy host auth files, mount host `.codex`, or require OpenAI API-key auth.
* One account must map to one reusable Codex CLI session by default. `prod-online-run-once` and `prod-online-run-loop` must share the same stored session for the same account.
* Stored account session ids do not expire by default; production entrypoints may opt into age reset with `--codex-session-max-age-hours`.
* `prod-online-run-once` may accept `--one-time-prompt` for a single operator-provided hint. `prod-online-run-loop` must not accept this flag.

## Codex Invocation

The production draft generator must call `codex exec` non-interactively with:

* `--json` so the runtime can read JSONL events, capture `thread.started.thread_id`, and parse the final `agent_message`;
* no `--ephemeral` for production draft generation, because account-level session reuse is required;
* `codex exec resume <stored_thread_id>` when a session record already exists for the account;
* global `--ask-for-approval never` before `exec`, plus `--sandbox read-only` on `exec`, so draft generation cannot mutate the repo or hang on approvals;
* global `--search` before `exec`, so Codex can use its non-X web search tool for background verification when available;
* `--output-schema` with the existing posting draft schema;
* stdin prompt payload containing the account prompt, source context, recent posts, memory, and guardrails;
* no browser automation and no `x.com` access.

Codex may use non-X web search when available in the local Codex runtime for verification/background, but public X facts must come from supplied evidence materials. If a new non-X web fact is central and not represented by evidence, the draft should include the source URL so downstream policy routes it to human review.

## One-Time Operator Prompt

* A once-only prompt is temporary run context, commonly used when the operator saw a promising public post or topic and wants the AI to collect related signals and re-check sources.
* The prompt may influence source query derivation, topic selection, and Codex drafting for that run.
* The prompt must be marked as temporary in the composed prompt and must not become account profile, account prompt, memory, or long-term strategy by itself.
* Runtime records may store `one_time_prompt_sha256`; they must not store the full prompt as persistent account configuration.

## Account Session Store

* Default session metadata directory is `data/codex-sessions`.
* A session metadata file may contain only `accountKey`, Codex `threadId`, and `updatedAt`.
* Session metadata must not contain prompt plaintext, source materials, recent posts, generated draft text, credentials, cookies, auth files, or full Codex transcript content.
* Reset is explicit and local: `just local-codex-reset-session --account <account>` deletes the stored thread id, so the next production draft starts a new Codex session and stores its new thread id.
* Automatic age reset is disabled unless `--codex-session-max-age-hours` is provided. When enabled, metadata older than the configured max age is treated as expired and starts a new Codex session.

## Ledger And Safety

* Runtime ledger must record provider `codex` for LLM draft API audit rows.
* Prompt plaintext must not be written to the runtime ledger; prompt hash and sanitized input refs are allowed.
* Failed Codex execution or invalid JSON output must fail the draft generation path clearly; it must not be treated as a skipped post or fake success.
* Default tests and Close Gate verification remain offline only and must use fake Codex exec runners.
