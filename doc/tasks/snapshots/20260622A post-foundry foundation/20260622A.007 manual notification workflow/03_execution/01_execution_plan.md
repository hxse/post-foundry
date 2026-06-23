# Execution Plan

## Steps

1. 收口 `.006`，把 `dev` bookmark 前移到 `.006`。
2. 从 `.006` 创建新 `jj` change：`task 20260622A.007 manual notification workflow`。
3. 新增 `src/lib/notifications/manual-notification.ts`。
4. 新增 `tests/manual-notification-offline.test.ts`。
5. 新增 `just test-manual-notification-offline`。
6. 更新 task index 和 Close Gate review。
7. 只运行离线验证，不执行真实 Telegram 发送。

## Validation Commands

```text
nix shell nixpkgs#nodejs --command just check
nix shell nixpkgs#nodejs --command just test-manual-notification-offline
nix shell nixpkgs#nodejs --command just test
git diff --check
```
