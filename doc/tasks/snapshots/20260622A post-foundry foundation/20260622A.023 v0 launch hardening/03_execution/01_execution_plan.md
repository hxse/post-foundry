# Execution Plan

1. Close `.022` and create a dedicated `.023` jj change.
2. Add local production preflight for once and loop entrypoints.
3. Treat placeholder example secret values as absent, so optional account placeholders do not override real global keys.
4. Keep provider construction and runtime DB open after preflight.
5. Document the v0 manual runbook and no-online-validation boundary.
6. Run focused offline tests, type check, full offline test suite, `just --list`, and whitespace checks.
