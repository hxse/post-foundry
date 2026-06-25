# Execution Plan

1. Add production draft generator boundary.
   * Keep offline tests fake-provider only.
   * Add production draft provider for production CLI. Superseded by `.025`, which uses Codex CLI instead of OpenAI API.

2. Add production operation executor.
   * Reuse source collection, topic radar, source context, account memory, draft gate, policy, Telegram and X publisher modules.
   * Keep source skipped/empty as terminal skipped states.
   * Record final actions for X auto post, Telegram notification, policy terminal noop and draft gate blocked.

3. Update production CLI.
   * `prod-online-run-once` and `prod-online-run-loop` use the v0 production operation executor.
   * Keep just native long arg entrypoints.

4. Add focused offline tests.
   * No external API, OAuth, Telegram, X official, browser, or real posting.

5. Update docs and task index.
