# ----------------------------------------------------------------------
# Quality gates: offline only, no external API, safe for CI
# ----------------------------------------------------------------------

_node-for-vitest:
    @command -v node >/dev/null || (echo "Node.js is required for Vitest. Run inside a shell that provides node, for example: nix shell nixpkgs#nodejs" >&2; exit 127)

check: _node-for-vitest
    bun run check

test: _node-for-vitest
    bun run test

test-offline: _node-for-vitest
    bun run test

test-offline-account-memory: _node-for-vitest
    bun run test:account-memory-offline

test-offline-llm-draft-adapter: _node-for-vitest
    bun run test:llm-draft-adapter-offline

test-offline-api: _node-for-vitest
    bun run test:api-offline

test-offline-accounts: _node-for-vitest
    bun run test:accounts-offline

test-offline-account-prompt: _node-for-vitest
    bun run test:account-prompt-offline

test-offline-ai-posting-pipeline: _node-for-vitest
    bun run test:ai-posting-pipeline-offline

test-offline-audit: _node-for-vitest
    bun run test:audit-offline

test-offline-manual-notification: _node-for-vitest
    bun run test:manual-notification-offline

test-offline-online-runner: _node-for-vitest
    bun run test:online-runner-offline

test-offline-run-once-fixture: _node-for-vitest
    bun run test:run-once-operation-executor-offline

test-offline-orchestration: _node-for-vitest
    bun run test:offline-orchestration

test-offline-policy: _node-for-vitest
    bun run test:policy-offline

test-offline-production-run-once: _node-for-vitest
    bun run test:production-run-once-offline

test-offline-source-adapters: _node-for-vitest
    bun run test:source-adapters-offline

test-offline-source-collection: _node-for-vitest
    bun run test:source-collection-offline

test-offline-source-ingestion: _node-for-vitest
    bun run test:source-ingestion-offline

test-offline-storage: _node-for-vitest
    bun run test:storage-offline

test-offline-telegram: _node-for-vitest
    bun run test:telegram-offline

test-offline-topic-radar: _node-for-vitest
    bun run test:topic-radar-offline

# ----------------------------------------------------------------------
# Local runtime tools: local filesystem / SQLite only, no external API
# ----------------------------------------------------------------------

local-init-secrets:
    @mkdir -p secrets
    @if [ -e secrets/accounts.local.json ]; then chmod 600 secrets/accounts.local.json && echo "secrets/accounts.local.json already exists; ensured mode 600"; else install -m 600 secrets/accounts.local.example.json secrets/accounts.local.json && echo "created secrets/accounts.local.json from example with mode 600"; fi

local-runtime-health: _node-for-vitest
    node_modules/.bin/vite-node src/cli/runtime-health.ts

# ----------------------------------------------------------------------
# Offline debug: fixture/stub data only, may write local SQLite, no external API
# ----------------------------------------------------------------------

# OFFLINE FIXTURE: fake source/draft/Telegram path. Requires explicit --db-file.
debug-offline-run-once-fixture *ARGS:
    bun run src/cli/debug-run-once-offline-fixture.ts {{ARGS}}

# ----------------------------------------------------------------------
# Online debug: real external APIs, manual only, may cost money
# ----------------------------------------------------------------------

# REAL API: TwitterAPI.io + X official auth checks. Requires --allow-real-post for real posting.
debug-online-api-smoke *ARGS:
    bun run src/cli/debug-api-online.ts {{ARGS}}

# REAL API: TwitterAPI.io. Dry-run by default; requires --collect and explicit --config-file for network + DB writes.
debug-online-source-collection *ARGS:
    bun run src/cli/debug-online-source-collection.ts {{ARGS}}

# REAL API: Telegram Bot API. Dry-run by default; requires --send for real notification.
debug-online-telegram *ARGS:
    bun run src/cli/debug-tg-online.ts {{ARGS}}

# REAL API: X OAuth token refresh/exchange. Writes secrets.
debug-online-x-token-refresh *ARGS:
    bun run src/cli/x-token.ts {{ARGS}}

# REAL API: X OAuth authorization callback/token exchange. Writes secrets.
debug-online-x-token-auth *ARGS:
    bun run src/cli/x-token-auth.ts {{ARGS}}

# ----------------------------------------------------------------------
# Production online runtime: real account operation entrypoints
# ----------------------------------------------------------------------

# PROD ONLINE: run one source/topic/context cycle with real external APIs.
[arg("account", long="account")]
[arg("config_file", long="config-file")]
[arg("secrets_file", long="secrets-file")]
[arg("db_file", long="db-file")]
[arg("source_max_queries", long="source-max-queries")]
[arg("source_per_query_limit", long="source-per-query-limit")]
[arg("lock_dir", long="lock-dir")]
[arg("lock_ttl_seconds", long="lock-ttl-seconds")]
[arg("lock_wait_timeout_seconds", long="lock-wait-timeout-seconds")]
[arg("lock_poll_interval_ms", long="lock-poll-interval-ms")]
prod-online-run-once account config_file secrets_file="secrets/accounts.local.json" db_file="data/post-foundry.sqlite" source_max_queries="3" source_per_query_limit="5" lock_dir="data/locks" lock_ttl_seconds="7200" lock_wait_timeout_seconds="7200" lock_poll_interval_ms="1000":
    bun run src/cli/run-once-online.ts --account "{{ account }}" --config-file "{{ config_file }}" --secrets-file "{{ secrets_file }}" --db-file "{{ db_file }}" --source-max-queries "{{ source_max_queries }}" --source-per-query-limit "{{ source_per_query_limit }}" --lock-dir "{{ lock_dir }}" --lock-ttl-seconds "{{ lock_ttl_seconds }}" --lock-wait-timeout-seconds "{{ lock_wait_timeout_seconds }}" --lock-poll-interval-ms "{{ lock_poll_interval_ms }}"

# PROD ONLINE: loop source/topic/context cycles with real external APIs.
[arg("account", long="account")]
[arg("config_file", long="config-file")]
[arg("secrets_file", long="secrets-file")]
[arg("db_file", long="db-file")]
[arg("source_max_queries", long="source-max-queries")]
[arg("source_per_query_limit", long="source-per-query-limit")]
[arg("lock_dir", long="lock-dir")]
[arg("lock_ttl_seconds", long="lock-ttl-seconds")]
[arg("lock_wait_timeout_seconds", long="lock-wait-timeout-seconds")]
[arg("lock_poll_interval_ms", long="lock-poll-interval-ms")]
[arg("interval_seconds", long="interval-seconds")]
[arg("jitter_seconds", long="jitter-seconds")]
[arg("sleep_utc", long="sleep-utc")]
[arg("max_iterations", long="max-iterations")]
prod-online-run-loop account config_file secrets_file="secrets/accounts.local.json" db_file="data/post-foundry.sqlite" source_max_queries="3" source_per_query_limit="5" lock_dir="data/locks" lock_ttl_seconds="7200" lock_wait_timeout_seconds="7200" lock_poll_interval_ms="1000" interval_seconds="28800" jitter_seconds="0" sleep_utc="" max_iterations="":
    set -- --account "{{ account }}" --config-file "{{ config_file }}" --secrets-file "{{ secrets_file }}" --db-file "{{ db_file }}" --source-max-queries "{{ source_max_queries }}" --source-per-query-limit "{{ source_per_query_limit }}" --lock-dir "{{ lock_dir }}" --lock-ttl-seconds "{{ lock_ttl_seconds }}" --lock-wait-timeout-seconds "{{ lock_wait_timeout_seconds }}" --lock-poll-interval-ms "{{ lock_poll_interval_ms }}" --interval-seconds "{{ interval_seconds }}" --jitter-seconds "{{ jitter_seconds }}"; if [ -n "{{ sleep_utc }}" ]; then set -- "$@" --sleep-utc "{{ sleep_utc }}"; fi; if [ -n "{{ max_iterations }}" ]; then set -- "$@" --max-iterations "{{ max_iterations }}"; fi; bun run src/cli/run-loop-online.ts "$@"
