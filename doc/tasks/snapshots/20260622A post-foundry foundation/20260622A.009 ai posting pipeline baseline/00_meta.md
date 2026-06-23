# Task Meta

* Task ID: `20260622A.009`
* Title: `ai posting pipeline baseline`
* Status: `已收口，Close Gate 通过`
* Parent task: `20260622A`
* Follows: `20260622A.008`
* Workspace change: `rpnxxlwu`

## Goal

把 AI 发帖方式落成离线、可审计的 draft pipeline baseline：先统计近期上下文和热点，重新查资料，再生成自然易懂的干货草稿，并在进入 policy 前做近期重复检测。

## Non-goals

* 不调用在线 LLM。
* 不抓取真实 X 数据、新闻或网页。
* 不执行真实 X 发帖。
* 不发送 Telegram。
* 不打开 `x.com`。
* 不实现正式 scheduler、worker 或完整热点排序。
