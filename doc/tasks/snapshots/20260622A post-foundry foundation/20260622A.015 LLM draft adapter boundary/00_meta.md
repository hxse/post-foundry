# Task Meta

* Task ID: `20260622A.015`
* Title: `LLM draft adapter boundary`
* Status: `已收口，Close Gate 通过`
* Parent task: `20260622A`
* Follows: `20260622A.014`
* Workspace change: `punwwlms`

## Goal

把 `.014` account memory、`.009` draft input package 和一个离线 fake LLM provider 接成可审计的草稿生成边界，让后续真实 LLM 接入前先固定 request contract、provider output parsing、prompt 明文保护和 ledger 写入语义。

## Non-goals

* 不调用在线 LLM。
* 不接 OpenAI、Anthropic 或其他真实模型 API。
* 不读取真实 X 数据。
* 不调用 X official API。
* 不发送 Telegram。
* 不实现 scheduler、真实发帖 executor 或在线成本统计。
* 不把 prompt 明文、post text 明文或 secrets 写入 ledger。
