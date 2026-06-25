# PostFoundry

PostFoundry is a local, auditable workflow for operating a small number of owned X accounts with Codex as the long-running account operator.

## Codex Login In Podman

PostFoundry's target production drafting runtime is the Codex CLI, not an OpenAI API-key draft service. This section defines the supported Codex login path for Podman. Codex must be installed and logged in inside the container that runs the production commands.

Only this login path is supported:

```bash
just local-codex-login
```

That command runs:

```bash
codex login --device-auth
```

Open the device-auth URL in your browser, enter the one-time code, and finish login. Do not copy host `~/.codex/auth.json`, do not bind-mount the host `.codex` directory, and do not use OpenAI API-key auth as the supported Codex runtime path. Production drafting invokes the local Codex CLI directly.

### Three-Layer Codex Check

Run these from inside the same Podman container and the same user account that will run production.

1. Check the Codex CLI binary:

```bash
just local-codex-version
```

2. Check local login status:

```bash
just local-codex-status
```

3. Run a real Codex smoke only when you explicitly want an online check:

```bash
just debug-online-codex-smoke
```

The smoke command calls `codex exec` once and may consume Codex quota. It is manual-only and must not be part of `just test`, CI, Close Gate automation, or unattended setup. Production commands also call `codex exec` when they reach draft generation, so run `just local-codex-status` before production.

### Podman Example

```bash
podman exec -it -w /workspace/post-foundry <container> just local-codex-version
podman exec -it -w /workspace/post-foundry <container> just local-codex-login
podman exec -it -w /workspace/post-foundry <container> just local-codex-status
```

After that, run the online smoke only if you want to verify an actual Codex model call:

```bash
podman exec -it -w /workspace/post-foundry <container> just debug-online-codex-smoke
```

If the container is recreated without a persistent home or `CODEX_HOME`, you must run `just local-codex-login` again inside the new container.

### Production Draft Runtime

`prod-online-run-once` and `prod-online-run-loop` run a local preflight before opening the runtime DB or calling external providers. That preflight checks `codex --version` and `codex login status`. These production commands print `[post-foundry]` progress lines for preflight, Codex runtime checks, DB open, lock handling, source collection, draft generation, policy, and final action stages. Draft generation uses `codex --ask-for-approval never --search exec --json --sandbox read-only --output-schema ...` with the account prompt and source context on stdin.

Production drafting reuses one Codex CLI session per account by default. PostFoundry stores only the account key, Codex thread id, and timestamp under `data/codex-sessions`; the actual conversation is managed by Codex in the logged-in environment. Once and loop use the same account session. Stored session ids do not expire by default; pass `--codex-session-max-age-hours` only when you explicitly want age-based reset. To start fresh for an account immediately, run `just local-codex-reset-session --account zh-tech` before the next production run.

`prod-online-run-once` also accepts an optional once-only operator hint, for example `just prod-online-run-once --account zh-tech --one-time-prompt "临时选题方向：BTC ETF"`. The hint is injected into this run only, can influence source collection and draft generation, and is recorded by hash rather than as a new account profile.

Use `just debug-online-post-preview --account zh-tech` when you want to inspect draft quality with real TwitterAPI.io source collection and real Codex drafting, but without any X post or Telegram notification. The command shares the same account lock and Codex account session as production, writes the local audit ledger, and prints the candidate text between `post_text_begin` and `post_text_end`.

Do not add OpenAI API keys to PostFoundry secrets for drafting. Codex CLI login is the supported runtime path.

## Safety Boundary

X data must never be read through browser automation or `x.com` pages. X official API is only for account actions such as posting and OAuth. Public X reads must use the configured public data provider, currently TwitterAPI.io. Non-X web research, such as Hacker News or project websites, is allowed for research and verification.
