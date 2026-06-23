# .004 Close Gate Review

## 结论

`20260622A.004 audit event ledger baseline` 已按当前 spec 收口。离线 Gate 通过；本轮没有执行任何在线 API、OAuth/token、真实发帖、Telegram bot 发送或第三方在线读回。

## 已交付

* 新增审计 migration：`0002_audit_event_ledger_baseline`。
* 新增审计表：`audit_events`、`ai_runs`、`ai_decisions`、`ai_actions`、`evidence_refs`、`human_reviews`。
* 新增 repo 写入/查询 API，所有记录按 `account_uuid` 归属。
* repo 会拒绝跨账号引用 run / decision / action。
* repo 会拒绝把同账号内无关的 decision / action 绑到同一条 human review。
* repo 会校验 ISO datetime、非空 actor / trace / subject、confidence 范围、必要 causal link 和运行时枚举值。
* `runtime-health` 和 SvelteKit 状态页显示审计表计数。
* 新增 `just test-audit-offline`。

## 验证结果

```text
nix shell nixpkgs#nodejs --command just check
PASS

nix shell nixpkgs#nodejs --command just test-audit-offline
PASS, 5 tests

nix shell nixpkgs#nodejs --command just test-storage-offline
PASS, 4 tests

nix shell nixpkgs#nodejs --command just test
PASS, 40 tests

nix shell nixpkgs#nodejs --command just runtime-health
PASS

nix shell nixpkgs#nodejs --command node node_modules/vite/bin/vite.js build
PASS

local dev server + Playwright localhost snapshot
PASS

git diff --check
PASS
```

## 未执行项

本轮没有执行 `just debug-api-online`、`just x-token`、`just x-token-auth`、TwitterAPI.io 在线查询、X OAuth token endpoint、X official API、真实发帖、Telegram bot 发送或第三方在线读回。

## 残余风险

`.004` 只提供审计账本和本地 repo API；它不保证未来所有调用方都会写审计记录。后续 `.005 automation policy engine` 和 `.006 Telegram approval bot` 必须把写 ledger 作为硬约束，而不是可选日志。
