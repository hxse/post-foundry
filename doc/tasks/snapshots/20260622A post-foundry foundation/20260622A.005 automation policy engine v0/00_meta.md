# Task Meta

* Task ID: `20260622A.005`
* Title: `automation policy engine v0`
* Status: `已收口，Close Gate 通过`
* Parent task: `20260622A`
* Follows: `20260622A.004`
* Workspace change: `mxvsukvp`

## Goal

把“普通无链接帖可自动发、带链接帖进入 Telegram human gate、所有判断进入审计账本”的运营规则落成一个离线 policy engine。

## Non-goals

* 不执行真实发帖。
* 不发送 Telegram 消息。
* 不调用在线 API、OAuth/token endpoint 或第三方读回。
* 不实现 AI 生成内容，只评估已经形成的候选帖。
* 不改变 `.001` 的 X 安全边界。
