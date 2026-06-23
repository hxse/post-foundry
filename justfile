check: _node-for-vitest
    bun run check

init-secrets:
    @mkdir -p secrets
    @if [ -e secrets/accounts.local.json ]; then chmod 600 secrets/accounts.local.json && echo "secrets/accounts.local.json already exists; ensured mode 600"; else install -m 600 secrets/accounts.local.example.json secrets/accounts.local.json && echo "created secrets/accounts.local.json from example with mode 600"; fi

_node-for-vitest:
    @command -v node >/dev/null || (echo "Node.js is required for Vitest. Run inside a shell that provides node, for example: nix shell nixpkgs#nodejs" >&2; exit 127)

test: _node-for-vitest
    bun run test

test-api-offline: _node-for-vitest
    bun run test:api-offline

test-accounts-offline: _node-for-vitest
    bun run test:accounts-offline

test-account-prompt-offline: _node-for-vitest
    bun run test:account-prompt-offline

test-ai-posting-pipeline-offline: _node-for-vitest
    bun run test:ai-posting-pipeline-offline

test-audit-offline: _node-for-vitest
    bun run test:audit-offline

test-manual-notification-offline: _node-for-vitest
    bun run test:manual-notification-offline

test-policy-offline: _node-for-vitest
    bun run test:policy-offline

test-source-adapters-offline: _node-for-vitest
    bun run test:source-adapters-offline

test-source-ingestion-offline: _node-for-vitest
    bun run test:source-ingestion-offline

test-storage-offline: _node-for-vitest
    bun run test:storage-offline

test-telegram-offline: _node-for-vitest
    bun run test:telegram-offline

test-topic-radar-offline: _node-for-vitest
    bun run test:topic-radar-offline

runtime-health: _node-for-vitest
    bun run runtime-health

debug-api-online *ARGS:
    bun run src/cli/debug-api-online.ts {{ARGS}}

debug-tg-online *ARGS:
    bun run src/cli/debug-tg-online.ts {{ARGS}}

x-token *ARGS:
    bun run src/cli/x-token.ts {{ARGS}}

x-token-auth *ARGS:
    bun run src/cli/x-token-auth.ts {{ARGS}}
