# 20260622A.019 Production Run-Once Source Collection Integration

## Status

已收口，Close Gate 通过。

## Scope

把 `.018` production source collection v0 接入 `.016` once/loop runner 和 `.017` production entrypoint。`.019` 只允许执行第三方公开 X 数据采集并写本地 ledger，不调用在线 LLM、不发送 Telegram、不调用 X official 发帖。

## Boundary

* `prod-online-run-once` 和 `prod-online-run-loop` 是真实在线生产入口，人工手动运行，可能产生 TwitterAPI.io 费用。
* 生产入口必须显式传真实 `--config-file`，不得使用 `config/accounts.example.json`。
* 生产入口必须复用同一个 source collection executor；loop 只是 once executor 的定时复用。
* 本任务不打开 `x.com`，不使用浏览器/MCP/Playwright，不执行 OAuth 或真实发帖。
