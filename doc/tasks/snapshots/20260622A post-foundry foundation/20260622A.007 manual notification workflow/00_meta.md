# Task Meta

* Task ID: `20260622A.007`
* Title: `manual notification workflow`
* Status: `已收口，Close Gate 通过`
* Parent task: `20260622A`
* Follows: `20260622A.006`
* Workspace change: `tmxwzoxu`

## Goal

把 `.005` automation policy 和 `.006` Telegram notification adapter 接成一条完整的人工处理通知流。

## Non-goals

* 不执行真实 Telegram 发送。
* 不实现审批按钮、webhook、long polling 或回调。
* 不执行真实 X 发帖。
* 不调用 X official API、TwitterAPI.io、OAuth token endpoint 或在线 LLM。
* 不通知 `auto_post`、`reject`、`defer` 的普通结果。
