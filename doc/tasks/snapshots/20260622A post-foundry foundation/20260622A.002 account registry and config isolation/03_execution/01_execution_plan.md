# Execution Plan

## 阶段 1：配置模型

新增可提交的 `config/accounts.example.json`。示例必须包含两个账号，使用虚构 UUID、虚构 X 身份和 `oauth_token_status: "missing"`，不得包含真实 handle、token、client secret、cookie 或密码。

## 阶段 2：Registry Library

新增 `src/lib/accounts/registry.ts`：

* 用 Zod 校验账号配置。
* 建立 `account_uuid`、`account_key` 和 X identity 的索引。
* 拒绝重复 key、重复 uuid、重复 identity 和 unknown identity uuid。
* 提供可信 resolver。
* 提供配置快照 stable hash。
* 提供账号 key rename 和 audit record。

## 阶段 3：离线测试

新增 `tests/accounts-offline.test.ts`，覆盖：

* 示例配置可解析。
* `account_key` 解析到 `account_uuid`。
* 重复 key/uuid 被拒绝。
* 非敏感配置中的 token 字段被拒绝。
* 重命名不改变 `account_uuid`，并生成审计。
* 配置快照按 uuid/version/hash 记录。
* key/uuid 不一致时 resolver 拒绝。

## 阶段 4：验证与收口

运行离线验证：

```text
just check
nix shell nixpkgs#nodejs --command just test-accounts-offline
nix shell nixpkgs#nodejs --command just test
git diff --check
```

不运行任何在线 API 或真实发帖命令。验证通过后补 `04_review/01_close_gate_review.md` 并更新 task index。
