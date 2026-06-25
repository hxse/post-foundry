# Task Meta

* Task ID: `20260622A.018`
* Title: `production source collection v0`
* Status: `已收口，Close Gate 通过`
* Parent task: `20260622A`
* Follows: `20260622A.017`
* Workspace change: `yrvkkstw`

## Goal

把真实公开 X 数据读取接成可审计的 source collection 边界：按 source queries 调用 TwitterAPI.io provider，把结果转换成账号隔离的 source materials，并写入 API audit、AI run、evidence refs 和 audit event。

本任务只接第三方公开数据读取，不接 X official 发帖，不接在线 LLM，不把 source collection 自动接进 `prod-online-run-once`。

## Non-goals

* 不调用 X official API。
* 不发帖。
* 不调用在线 LLM。
* 不打开 `x.com`、不使用浏览器自动化、不使用网页登录态。
* 不把在线 source collection 放入默认测试或自动 Close Gate。
* 不把 source collection 自动接入生产 run-once executor。
