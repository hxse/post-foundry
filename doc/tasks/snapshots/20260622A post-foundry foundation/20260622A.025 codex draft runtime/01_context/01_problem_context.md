# Problem Context

The project target is Codex-as-operator, not a separate OpenAI API-key drafting service. After .024, the user-facing account setup was simplified into local secrets, compact profile JSON, and prompt markdown, but production once/loop entrypoints still loaded OpenAI API credentials and wired an OpenAI Responses draft generator.

That created three problems:

* operators had to maintain a provider block they did not intend to use;
* a missing or stale Codex login could be discovered only after paid source collection had already run;
* ledger/provider naming implied a different runtime than the actual product direction.

.025 moves production drafting to the Codex CLI available in the current environment. The supported auth path remains logging in inside the container with `just local-codex-login`. This task does not run a real Codex model call, production run, TwitterAPI.io, X official API, Telegram, OAuth, browser automation, or `x.com`.
