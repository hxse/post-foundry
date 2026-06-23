# Execution Plan

## Steps

1. 从 `.003` 创建新的 `jj` change：`task 20260622A.004 audit/event ledger baseline`。
2. 新增 Drizzle schema 表定义：
   * `audit_events`
   * `ai_runs`
   * `ai_decisions`
   * `ai_actions`
   * `evidence_refs`
   * `human_reviews`
3. 新增 runtime migration：`0002_audit_event_ledger_baseline`。
4. 扩展 `RuntimeRepository`：
   * 写入 AI run / decision / action / evidence / human review / audit event。
   * 按 `account_uuid` 查询。
   * 校验跨账号引用。
5. 扩展 runtime health：
   * CLI JSON 输出审计表计数。
   * SvelteKit 薄页面显示 Audit 面板。
6. 新增 `tests/audit-ledger-offline.test.ts` 和 `just test-audit-offline`。
7. 更新 task index 和 Close Gate review。
8. 只运行离线验证，不执行任何在线命令。

## Validation Commands

```text
nix shell nixpkgs#nodejs --command just check
nix shell nixpkgs#nodejs --command just test-audit-offline
nix shell nixpkgs#nodejs --command just test-storage-offline
nix shell nixpkgs#nodejs --command just test
nix shell nixpkgs#nodejs --command just runtime-health
nix shell nixpkgs#nodejs --command node node_modules/vite/bin/vite.js build
```
