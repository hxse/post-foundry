# Execution Plan

## Steps

1. 收口 `.005`，把 `dev` bookmark 前移到 `.005`。
2. 从 `.005` 创建新 `jj` change：`task 20260622A.006 telegram notification connectivity harness`。
3. 扩展 secrets schema 和 `secrets/accounts.local.example.json`。
4. 新增 Telegram Bot API adapter。
5. 新增 `debug-tg-online` CLI。
6. 新增 Telegram 通知文本策略。
7. 新增 `tests/telegram-offline.test.ts`。
8. 新增 `just test-telegram-offline` 和 `just debug-tg-online`。
9. 更新 task index 和 Close Gate review。

## Validation Commands

```text
nix shell nixpkgs#nodejs --command just check
nix shell nixpkgs#nodejs --command just test-telegram-offline
nix shell nixpkgs#nodejs --command just test
nix shell nixpkgs#nodejs --command just debug-tg-online --message "把复杂的事情记录下来，才有机会让判断慢慢变好。"
git diff --check
```
