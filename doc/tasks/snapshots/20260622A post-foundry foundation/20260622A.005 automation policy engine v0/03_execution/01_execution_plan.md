# Execution Plan

## Steps

1. 收口 `.004`，把 `dev` bookmark 前移到 `.004`。
2. 从 `.004` 创建新 `jj` change：`task 20260622A.005 automation policy engine v0`。
3. 新增 `src/lib/policy/automation.ts`：
   * `evaluateAutomationPolicy`
   * `recordAutomationPolicyDecision`
4. 新增 `tests/policy-offline.test.ts`。
5. 新增 `just test-policy-offline`。
6. 更新 task index 和 Close Gate review。
7. 只运行离线验证。

## Validation Commands

```text
nix shell nixpkgs#nodejs --command just check
nix shell nixpkgs#nodejs --command just test-policy-offline
nix shell nixpkgs#nodejs --command just test
nix shell nixpkgs#nodejs --command git diff --check
```
