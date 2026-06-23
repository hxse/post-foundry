# .005 Close Gate Review

## 结论

`20260622A.005 automation policy engine v0` 已按当前 spec 收口。离线 Gate 通过；本轮没有执行任何在线 API、OAuth/token、真实发帖、Telegram 发送或第三方在线读回。

## 已交付

* 新增 `evaluateAutomationPolicy`。
* 新增 `recordAutomationPolicyDecision`，把 policy decision 写入 `.004` ledger。
* 无链接合规候选帖输出 `auto_post` / `x_official_auto`。
* 带链接候选帖输出 `human_review` / `telegram_human_gate`。
* banned/debug/test 文案、excluded topic 和缺少 include topic 会被拒绝。
* ASCII topic 正文匹配使用词/短语边界，`daily` 不会误命中 `AI`。
* real posting disabled、daily max、cooldown、budget guard 会延后。
* policy decision 和 audit event 使用 repo transaction 原子写入，失败会回滚。
* 新增 `just test-policy-offline`。

## 验证结果

```text
nix shell nixpkgs#nodejs --command just check
PASS

nix shell nixpkgs#nodejs --command just test-policy-offline
PASS, 8 tests

nix shell nixpkgs#nodejs --command just test
PASS, 48 tests

git diff --check
PASS
```

## 未执行项

本轮没有执行 `just debug-api-online`、`just x-token`、`just x-token-auth`、TwitterAPI.io 在线查询、X OAuth token endpoint、X official API、真实发帖、Telegram bot 发送或第三方在线读回。

## 残余风险

`.005` 只判断策略和写审计记录，不负责真实执行。后续 executor 必须只消费 `auto_post` 且通过最新 policy 的候选帖；Telegram bot 必须只消费 `human_review` 的候选帖并把人工审批结果写回 ledger。
