# Execution Plan

1. Extend secrets schema with `profile_path`.
2. Add local profile loading under `secrets/`, including realpath boundary checks.
3. Generate internal `AccountConfig` from account key + profile, deriving `account_uuid`.
4. Remove production/debug `--config-file` args and load registry from secrets profile.
5. Delete `config/accounts.example.json`; move test-only registry data into code fixtures.
6. Add tracked secrets profile/prompt examples and make `local-init-secrets` copy ignored local files.
7. Derive public X source queries from the account initial prompt.
8. Replace monthly public X request caps with per-run source request limits.
9. Update focused offline tests and run offline verification only.
