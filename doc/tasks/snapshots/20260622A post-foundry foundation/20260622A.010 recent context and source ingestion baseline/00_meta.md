# Task Meta

* Task ID: `20260622A.010`
* Title: `recent context and source ingestion baseline`
* Status: `已收口，Close Gate 通过`
* Parent task: `20260622A`
* Follows: `20260622A.009`
* Workspace change: `yqswzlxp`

## Goal

为 `.009` AI 发帖 pipeline 准备离线上游输入：近期已发帖、候选热点、公开 X 高赞帖、网页/新闻资料和人工笔记需要统一成账号隔离、可审计、可复盘的 source context。

## Non-goals

* 不调用 TwitterAPI.io。
* 不调用 X official API。
* 不访问新闻网站或网页。
* 不调用在线 LLM。
* 不打开 `x.com`。
* 不执行真实发帖或 Telegram 发送。
* 不实现 scheduler、worker 或真实 crawler。
