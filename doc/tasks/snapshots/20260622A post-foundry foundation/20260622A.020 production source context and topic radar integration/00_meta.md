# 20260622A.020 Production Source Context And Topic Radar Integration

## Status

已收口，Close Gate 通过。

## Scope

把 `.019` production source collection 继续推进到 source context 和 topic radar。生产 once/loop 仍然只读取公开 X 数据并写本地 ledger，不调用在线 LLM、不发送 Telegram、不调用 X official 发帖。

## Boundary

* `prod-online-run-once` / `prod-online-run-loop` 仍是人工手动运行的真实在线入口。
* 运行顺序是 source collection -> topic radar -> source context。
* topic radar 需要账号初始 prompt 的 hash；prompt 明文只在内存中使用，不写入 ledger。
* source collection 被 cap/disabled/no keywords 跳过时，不继续 topic radar/source context。
* 本任务不打开 `x.com`，不使用浏览器/MCP/Playwright，不执行 OAuth 或真实发帖。
