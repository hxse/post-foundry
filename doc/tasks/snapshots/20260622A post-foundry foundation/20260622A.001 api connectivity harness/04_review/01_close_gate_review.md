# .001 Close Gate Review

## 结论

`20260622A.001 api connectivity harness` 已按当前 spec 收口。离线 Gate 通过；在线、真实外部服务、OAuth/token、真实发帖和第三方读回没有作为自动验证运行。

## 已修复项

* 真实发帖成功后，`debug-api-online --allow-real-post` 会调用 TwitterAPI.io `GET /twitter/tweets` 按 tweet id 执行第三方读回。
* 第三方读回 schema 校验 `tweets`、`status` 和 `message`；`status: "error"` 映射为 `provider_error`，不会被误判成 provider 索引延迟。
* 如果第三方读回遇到索引延迟、限流、schema drift、network failure 或其他 provider 错误，命令输出 warning 和 residual risk，不退回浏览器、MCP、Playwright 或 `x.com` 页面补验。
* `debug-api-online --allow-real-post` 在任何 TwitterAPI.io 或 X API 调用前会拦截明显测试/调试文案，返回 `real_post_not_allowed`。
* `just init-secrets` 创建或遇到已有 `secrets/accounts.local.json` 时都会确保文件权限为 `600`。
* `just x-token` 和 `just x-token-auth` 写回 token 后都会把 secrets 文件权限设为 `600`。
* 本机现有 `secrets/accounts.local.json` 已执行权限修复，当前 mode 为 `600`。

## 验证结果

```text
just check
PASS

nix shell nixpkgs#nodejs --command just test-api-offline
PASS, 23 tests

nix shell nixpkgs#nodejs --command just test
PASS, 23 tests
```

## 历史在线验证记录

本轮没有重复执行在线命令。此前人工明确要求下已执行过在线验证，记录如下：

* dry-run 在线链路曾在人工明确要求下通过：TwitterAPI.io search、X token 验证、X post dry-run 均成功；账号 key 已脱敏为 `redacted-account`，真实发帖跳过。
* 真实发帖曾在人工明确要求下执行一次，tweet id 已脱敏为 `redacted-real-tweet-id`。
* 该 tweet id 曾通过 TwitterAPI.io `GET /twitter/tweets` 第三方读回确认；作者和创建时间已脱敏为 `redacted-author`、`redacted-created-at`。
* 该历史测试帖文案不符合后续新增的真人化测试文案规则；后续真实测试帖必须遵守当前 spec，不得再使用机器味测试文案。

## 未执行项

本轮没有执行 `just debug-api-online`、`just x-token`、`just x-token-auth`、真实发帖、TwitterAPI.io 在线查询或第三方在线读回。原因是在线和可能计费命令只能由用户当前明确要求后手动运行，不属于 .001 自动 Close Gate。

残余风险：第三方 provider 的真实响应形态、索引延迟和在线限流只能在人工明确要求的在线 debug 中确认。
