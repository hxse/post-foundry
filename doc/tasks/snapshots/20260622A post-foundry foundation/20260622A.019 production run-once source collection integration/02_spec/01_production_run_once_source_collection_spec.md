# Production Run-Once Source Collection Spec

## Contract

`prod-online-run-once` 必须：

* 要求 `--account`。
* 要求显式 `--config-file`，且拒绝 `config/accounts.example.json` 的相对或绝对路径。
* 读取本地 secrets，构造 TwitterAPI.io provider。
* 打开 runtime DB 并复用 account lock。
* upsert registry accounts / identities，保存 account config snapshot。
* 调用 `.018` `collectAccountPublicXSourceBatch`。
* 返回 `source_collection_collected` 或 `source_collection_skipped`。
* summary 只包含计数、状态、audit ids 和 config snapshot id，不包含 source 原文全文。

`prod-online-run-loop` 必须复用同一个 production source collection executor；它只是按 `.016` loop interval / jitter / sleep window 定时调用 once runner。

## Explicit Non-Scope

`.019` 不允许：

* 调用在线 LLM。
* 调用 X official 发帖或 OAuth。
* 发送 Telegram。
* 打开 `x.com` 或使用浏览器自动化。
* 使用 fixture 假数据作为 production entrypoint 的默认行为。

## Acceptance

离线测试必须证明：

* production run-once parser 拒绝缺失 `--config-file`、拒绝 example config 绝对路径、限制 source query 上限。
* fake provider 下，once runner 能执行 source collection 并写 ledger。
* 达到月度 request cap 时不会调用 provider。
* account mismatch 在任何 source collection side effect 前被拒绝。
* runner 内部 entrypoint 使用 canonical `prod-online-run-once` / `prod-online-run-loop`。
