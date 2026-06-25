# Problem Context

`.021` made the production operation loop capable of reaching X official auto-post. That is not enough for an auditable operator: after a real post succeeds, the system needs a provider-independent public readback record and a compact performance snapshot that future account memory can consume.

The project boundary remains strict: X official API performs account actions, while public X reads use a third-party public data API. A successful post must never be verified by opening `x.com` or through browser automation.

V0 only needs a baseline loop:

1. X official API returns a tweet id.
2. TwitterAPI.io `getPostById` reads the public post by id.
3. Ledger records readback status, provider audit, evidence ref when confirmed, and compact metrics.
4. Account memory exposes the result as per-trace performance context for later reflection.

If TwitterAPI.io has not indexed the post yet, production should not rewrite the already-successful X action as failed. It should record `not_found` or `failed` readback status and leave a residual risk for later retry/inspection.
