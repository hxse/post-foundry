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

Open the device-auth URL in your browser, enter the one-time code, and finish login. Do not copy host `~/.codex/auth.json`, do not bind-mount the host `.codex` directory, and do not use OpenAI API-key auth as the supported Codex runtime path. Any legacy OpenAI draft-provider code or config should be treated as migration debt, not operator setup.

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

The smoke command calls `codex exec` once and may consume Codex quota. It is manual-only and must not be part of `just test`, CI, Close Gate automation, or unattended setup.

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

## Safety Boundary

X data must never be read through browser automation or `x.com` pages. X official API is only for account actions such as posting and OAuth. Public X reads must use the configured public data provider, currently TwitterAPI.io. Non-X web research, such as Hacker News or project websites, is allowed for research and verification.
