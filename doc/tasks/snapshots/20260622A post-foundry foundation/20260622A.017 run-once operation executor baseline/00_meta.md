# Task Meta

* Task ID: `20260622A.017`
* Title: `run-once operation executor baseline`
* Status: `已收口，Close Gate 通过`
* Parent task: `20260622A`
* Follows: `20260622A.016`
* Workspace change: `rrxorzzu`

## Goal

固定 run-once operation executor 的离线边界，并保持生产入口语义纯净：`run-once-online` 和 `run-loop-online` 仍然是未来真实生产链路入口，在生产 executor 接好前只返回 `not_wired`，不得写 fixture ledger；离线 fixture executor 只能通过 focused offline test 或显式 offline fixture debug 入口运行。

`.017` 的核心产物是一个可替换的 fixture executor，用来证明单次运营流程可以复用 `.013` orchestration 写完整 trace/ledger。后续真实 source、LLM、Telegram 和 X official publisher 必须替换 fixture，而不是污染 `run-*-online` 的生产语义。

## Non-goals

* 不调用在线 LLM。
* 不调用 TwitterAPI.io 或新闻站点。
* 不调用 X official API 发帖。
* 不发送真实 Telegram。
* 不打开 `x.com`、不使用浏览器自动化、不使用网页登录态。
* 不让 production online CLI 默认写假数据或 fixture ledger。
* 不实现真实排程 daemon、系统服务或长期后台 supervisor。
