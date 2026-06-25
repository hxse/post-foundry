# Execution Plan

1. Add a Codex CLI production draft generator around `codex exec` with a fakeable runner for offline tests.
2. Replace production once/loop OpenAI wiring with Codex CLI wiring.
3. Replace OpenAI API-key preflight with local Codex CLI version/login preflight.
4. Remove OpenAI credentials from local secrets examples and resolvers.
5. Add account-level Codex session reuse by capturing JSONL `thread.started.thread_id`, storing only local thread metadata, and resuming the same thread for the same account across once and loop entrypoints.
6. Add explicit local reset command for starting a fresh Codex session per account.
7. Add opt-in session age reset without changing the default same-account reuse behavior.
8. Add once-only operator prompt support to `prod-online-run-once` and keep it out of loop.
9. Add production progress logging so manual online runs do not appear stuck during Codex runtime checks, lock waits, source collection, or draft generation.
10. Update production tests, focused Codex provider tests, README, AGENTS, and task index.
