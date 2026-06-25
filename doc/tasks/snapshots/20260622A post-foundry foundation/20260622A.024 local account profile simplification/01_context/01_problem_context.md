# Problem Context

The previous account setup forced the operator to maintain both `config/accounts.local.json` and `secrets/accounts.local.json`. That made the local v0 workflow heavier than the product goal requires. The user should not hand-maintain `account_uuid`, duplicate account identity across files, or copy structured topic/style/data-source blocks when the account prompt already carries the natural-language operating intent.

The durable audit ledger still needs a stable internal account id, but that is a system concern. The operator-facing contract should be one account key in the ignored secrets file, plus references to local files under `secrets/`.
