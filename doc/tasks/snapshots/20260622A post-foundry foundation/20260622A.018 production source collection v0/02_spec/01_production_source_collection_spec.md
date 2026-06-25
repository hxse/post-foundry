# Production Source Collection Spec

## Boundary

`.018` 只允许通过第三方公开数据 API 读取公开 X 数据。当前 provider 是 TwitterAPI.io，经由 `.011` 的 `PublicXDataProvider` / `collectTwitterApiIoSearchMaterials` adapter 转换为 `SourceMaterialInput`。

禁止使用浏览器、MCP 浏览器、Playwright、网页登录态、cookie 或 `x.com` 页面读取、验证或补数据。

## Collection Contract

`collectAccountPublicXSourceBatch` 必须：

* 按 `account_uuid` 归属所有输出。
* 使用调用方传入的 source queries 作为 query 来源；.024 后生产路径从账号初始 prompt 派生这些 queries。
* 尊重 `account.enabled`、`data_sources.public_x.enabled` 和 `max_requests_per_run`。
* 支持 `maxQueries` 和 `perQueryLimit`，两者最大值均为 `10`；实际 query 数不得超过账号 profile 的 `source.max_requests_per_run`。
* 每个 query 调用一次 TwitterAPI.io adapter，并写一条 `api_call_audit`。
* 对重复 source material id 去重。
* 写一条整体 `ai_runs`，purpose 为 `public_x_source_collection`。
* 为 material 写 `evidence_refs`，metadata 只保存 hash、topic tags、engagement 等摘要，不保存大段全文。
* 写一条 `audit_events`，event type 为 collected / skipped / failed。
* provider 失败时记录 failed ai_run 和 audit event，但对调用方保留原 provider error。

## Manual Online Debug

`.018` 提供手动 online debug 入口：

* `just debug-online-source-collection --account zh-tech`
* 默认 dry-run，只读取本地 secrets/profile/prompt 并打印计划，不访问 TwitterAPI.io。
* 必须加 `--collect` 才会读取 credentials、访问 TwitterAPI.io 并写 runtime ledger.
* 不支持 `--config-file`; .024 后账号入口固定为 `secrets/accounts.local.json`，可用 `--secrets-file` 指向其他 ignored secrets 文件。
* 可传 `--db-file /path/to/db.sqlite` 指定写入数据库；不传则使用默认 runtime DB。

该入口属于在线/可能计费命令，不能进入 `just test`、CI、自动 Close Gate 或 agent 自主验证流程。

## Acceptance

离线测试必须证明：

* 成功收集时写入 API audit、AI run、evidence refs 和 audit event。
* AI run output 不包含 source 原文全文，只包含 material ids 和文本 hash。
* 没有 source queries 时跳过 provider 调用并写 skipped ledger。
* 每次 run 的 source 请求数不得超过 `source.max_requests_per_run`.
* provider 失败时记录 failed ledger，同时保留原 provider error。
* 非法 limit 在 provider 调用前拒绝。

本任务不得执行在线 API、OAuth、X official、Telegram、网页登录或真实发帖。
