# Close Gate Review

Close Gate passed on 2026-06-25.

Accepted scope:

* User-facing production/debug account loading no longer requires `config/accounts.local.json`.
* `--config-file` is rejected as an unknown production/debug argument.
* Local profile path must be relative, `.json`, and resolve under `secrets/`.
* Account UUID is derived internally from account key.
* Profile source config only exposes `max_requests_per_run`, default `10`; source search queries are derived from the account initial prompt, and this cap only applies to X/TwitterAPI.io search requests.
* Monthly public X request caps were removed from source collection and automation policy.
* The extra real-posting environment guard was removed from production preflight and X publisher flow; production posting now depends on the `prod-online-*` entrypoint, account posting config, and policy decision.
* Focused offline tests cover secrets-profile registry loading, prompt-derived source queries, per-run request limits, updated CLI args, and real-posting guard removal.
* The zh-tech prompt now documents Chinese-first writing, natural English technical terms, X hotspot discovery, non-X source discovery, and source-specific verification rules for GitHub Trending, Hacker News, HN Algolia, Hugging Face Papers, arXiv, Techmeme, Lobsters, Product Hunt, The Batch, Latent Space, and SemiAnalysis.

Final offline verification passed: `nix shell nixpkgs#nodejs --command just check`, `nix shell nixpkgs#nodejs --command just test`, and `git diff --check`. Focused checks also passed during implementation: `test-offline-api`, `test-offline-accounts`, `test-offline-source-collection`, `test-offline-policy`, `test-offline-production-run-once`, and `test-offline-production-operation`. Online validation was not executed and is not required for this refactor.
