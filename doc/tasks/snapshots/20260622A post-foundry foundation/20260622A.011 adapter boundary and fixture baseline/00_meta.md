# Task Meta

* Task ID: `20260622A.011`
* Title: `adapter boundary and fixture baseline`
* Status: `已收口，Close Gate 通过`
* Parent task: `20260622A`
* Follows: `20260622A.010`
* Workspace change: `xkykmrxz`

## Goal

定义真实数据 adapter 的离线边界，让 TwitterAPI.io、manual notes、web/news fixture 都能产出 `.010` 可消费的 `SourceMaterialInput`，并同时形成 `api_call_audit` contract。

## Non-goals

* 不调用真实 TwitterAPI.io。
* 不抓新闻或网页。
* 不访问 `x.com`。
* 不调用 X official API。
* 不调用在线 LLM。
* 不执行真实发帖或 Telegram 发送。
* 不实现 scheduler、crawler 或在线 debug CLI。
