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

test-storage-offline: _node-for-vitest
    bun run test:storage-offline

runtime-health: _node-for-vitest
    bun run runtime-health

debug-api-online *ARGS:
    bun run src/cli/debug-api-online.ts {{ARGS}}

x-token *ARGS:
    bun run src/cli/x-token.ts {{ARGS}}

x-token-auth *ARGS:
    bun run src/cli/x-token-auth.ts {{ARGS}}
