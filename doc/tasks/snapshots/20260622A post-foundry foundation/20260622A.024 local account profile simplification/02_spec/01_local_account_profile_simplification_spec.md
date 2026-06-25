# Spec

## User-Facing Configuration

* Delete `config/accounts.example.json` as a real account configuration template.
* Production and online debug entrypoints must not require `--config-file`.
* The operator maintains `secrets/accounts.local.json` as the only account entrypoint.
* Each account is keyed by the object key, for example `accounts.zh-tech`; no user-supplied `account_uuid` is required.
* Account entries may reference:
  * `profile_path`: relative `.json` path under `secrets/`;
  * `initial_prompt_path`: relative `.md` path under `secrets/`, or `initial_prompt`, mutually exclusive.

## Local Profile

The compact local profile keeps only the operational knobs that must remain structured:

* `posting`: cadence, daily min/max, cooldown, approval flag, real posting flag.
* `source.max_requests_per_run`: maximum public X / TwitterAPI.io search requests per run, default `10`; source queries are derived from the account initial prompt, not duplicated in JSON. This cap does not apply to non-X webpage research sources.

Structured topics, style, display name, platform, enabled flag, data source provider wrapper, config version, source search keywords, and extra real-posting environment guards are not operator-facing config. Natural-language strategy and topic direction remain in the account prompt. Production posting intent is expressed by the `prod-online-*` entrypoint plus `posting.real_posting_enabled`, not by a hidden environment variable.

## Source Query Strategy

V0 X source collection uses keyword / phrase search, not a global trending endpoint. The system derives candidate queries from natural-language prompt lines such as `账号方向：AI、开源工具、前沿科技`, hashtags, quoted terms, and compact ASCII topic tokens. TwitterAPI.io search results are then ranked downstream by source ingestion / topic radar using engagement and account fit. Non-X research sources such as Hacker News, project websites, papers/docs, company blogs, mainstream tech media, and market data pages are separate webpage research inputs and are not limited by `source.max_requests_per_run`. Hot-topic discovery beyond prompt-derived X seed queries can be added later as a separate source adapter.

## Internal Ledger Identity

The system derives an internal UUID from `account_key` for ledger foreign keys and snapshots. The operator does not need to know or configure this UUID.

## Boundaries

* No online API, OAuth, Telegram, X official call, TwitterAPI.io request, or real post is executed by this task.
* Existing historical docs may mention the older two-file model, but this task supersedes that operator-facing contract for current code.
