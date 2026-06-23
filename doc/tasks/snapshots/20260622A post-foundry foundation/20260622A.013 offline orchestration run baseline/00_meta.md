# Task Meta

* Task ID: `20260622A.013`
* Title: `offline orchestration run baseline`
* Status: `已收口，Close Gate 通过`
* Parent task: `20260622A`
* Follows: `20260622A.012`
* Workspace change: `pnxzkrqt`

## Goal

把 `.012` topic radar、`.010` source context、`.009` draft pipeline、`.005` policy 和 `.007` manual notification workflow 串成一条完整的离线运营闭环，让一次账号级 AI 运营决策可以用同一个 `trace_id` 回放和审计。

## Non-goals

* 不调用真实 TwitterAPI.io。
* 不抓新闻或网页。
* 不访问 `x.com`。
* 不调用 X official API。
* 不调用在线 LLM。
* 不发送真实 Telegram。
* 不执行真实发帖。
* 不实现 scheduler、daemon、队列 worker 或真实 executor。
