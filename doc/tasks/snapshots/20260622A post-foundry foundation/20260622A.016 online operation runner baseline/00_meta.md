# Task Meta

* Task ID: `20260622A.016`
* Title: `online operation runner baseline`
* Status: `已收口，Close Gate 通过`
* Parent task: `20260622A`
* Follows: `20260622A.015`
* Workspace change: `mylopwou`

## Goal

建立线上运营入口的运行底座：一个一次性 run 入口、一个循环 run 入口，二者必须复用同一个 `runOnlineOperationOnce` 基础能力，并用账号级锁保证同账号不会并发跑两条完整流程。

## Non-goals

* 不接真实 LLM provider。
* 不接真实 TwitterAPI.io source collection。
* 不调用 X official API 发帖。
* 不发送真实 Telegram。
* 不实现后台 daemon / systemd / supervisor。
* 不把在线 runner 放入默认自动测试或 CI 在线调用。
