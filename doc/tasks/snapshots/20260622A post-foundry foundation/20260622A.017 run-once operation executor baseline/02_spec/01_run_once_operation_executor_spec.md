# Run-Once Operation Executor Spec

## Production Entrypoint Boundary

`.017` 必须保持两个手动生产入口的语义纯净：

* `just run-once-online -- --account zh-tech`
* `just run-loop-online -- --account zh-tech --interval-seconds 28800`

在真实生产 executor 接入前，这两个入口只能返回 `not_wired` / `skipped`，说明 `production operation executor is not wired yet`。它们不得打开默认 runtime DB 写 fixture ledger，不得用假 source、假 draft 或 fake Telegram 冒充生产运行。

真实生产运行本身可以作为手动验收，但必须在后续真实 provider task 接好后，由用户明确要求执行；不能用 fixture 伪装生产测试。

## Offline Fixture Entrypoints

离线 fixture 只能通过明确的离线入口使用：

* `just test-run-once-operation-executor-offline`
* `just debug-run-once-offline-fixture -- --account zh-tech --db-file /tmp/post-foundry-fixture.sqlite`

`debug-run-once-offline-fixture` 必须要求显式 `--db-file`。它不能默认写 `data/post-foundry.sqlite`，避免把假数据混入正式运营历史。

## Executor Contract

`createFixtureRunOnceOperationExecutor` 必须返回 `.016` 定义的 `OnlineOperationExecutor`，并满足：

* executor 接收 runner/test/debug 提供的 `accountKey`、`traceId`、`entrypoint`、`startedAt`。
* executor 的 `accountKey` 必须和 context 一致，不一致时在写任何 fixture ledger 前拒绝。
* executor 负责 seed 非敏感账号配置到传入的 runtime repo。
* executor 负责创建 account config snapshot。
* executor 只把 prompt hash 写入后续 ledger，不得把 prompt 明文落盘。
* executor 调用 `.013` 的 `runOfflineOrchestration`，不得复制 topic/source/draft/policy/final action 逻辑。
* executor 返回 `completed`，即使最终动作是 `draft_blocked`、`policy_terminal` 或 `telegram_notification`；这些都表示一次运营判断已完成，而不是 runner 失败。

## Fixture Modes

baseline executor 必须支持 focused offline fixture modes：

* `auto_post`：无链接短帖，policy 输出 `auto_post`，最终 ledger action 是 `x_official_auto_post_planned`，仍然不真实发帖。
* `human_review_link`：带链接草稿，policy 输出 `human_review`，最终经过 fake Telegram sender 写入 notification ledger。
* `draft_blocked`：格式化草稿在 policy 前被 draft gate 拦截。
* `reject`：离题候选进入 policy terminal noop。

这些 mode 只用于离线测试和显式 offline fixture debug，不作为真实运营策略。

## Loop Reuse

离线测试必须证明 `.016` 的 `runOnlineOperationLoop` 可以复用同一个 executor 连跑多轮，并且每轮使用独立 trace id，避免 ledger 主键碰撞。生产 `run-loop-online` 在真实 executor 接入前仍然只能 `not_wired`。

## Safety Boundary

本任务不得执行在线 LLM、X official API、TwitterAPI.io、Telegram、OAuth、新闻抓取、网页登录、MCP 浏览器、Playwright 或真实发帖。

真实 provider 后续接入时，必须替换 fixture source/draft/sender，但保留 `.016` runner、账号锁、executor 边界、trace 语义和 ledger 写入要求。

## Acceptance

离线测试必须证明：

* once runner 调用 fixture executor 后能写入 topic/source/draft/policy/final action ledger。
* prompt 明文不会出现在 `ai_runs` ledger 中，prompt hash 可以审计。
* 带链接草稿会走 fake Telegram notification ledger，不发送真实 Telegram。
* draft gate blocked 分支不会进入 policy evaluation。
* reject fixture 会写 `policy_terminal_noop`。
* executor account mismatch 会在写 fixture ledger 前拒绝。
* loop 能复用同一个 executor 连跑多轮，且 trace/action id 不碰撞。
