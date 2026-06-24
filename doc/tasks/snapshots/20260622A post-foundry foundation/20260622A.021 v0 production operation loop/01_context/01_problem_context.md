# Problem Context

`.020` 已经让 `prod-online-run-once` / `prod-online-run-loop` 能完成 source collection -> topic radar -> source context，但还不能生成草稿、决策、发帖或通知。

继续按一个小模块一个子任务切下去会偏离 v0 目标。本任务把剩余的可上线试用闭环合并到一个 production executor 中：能跑一次完整生产操作，可发可不发，不为了发帖而发帖。

v0 的核心不是“每轮必发”，而是：

* 收集公开 X 热点资料。
* 选题并构建 source context。
* 读取账号级 memory，避免近期重复。
* 用 LLM 生成自然草稿。
* 用 draft gate 和 automation policy 判断是否可自动发。
* 短无链接合格帖自动走 X official API。
* 带链接或长帖走 Telegram 人工处理通知。
* reject/defer/draft blocked 只写 ledger，不打扰。
* 所有动作按同一个 trace 写入 runtime ledger，方便复盘和审计。

仍然禁止浏览器、MCP、Playwright、网页登录态、cookie 或 `x.com` 页面访问。
