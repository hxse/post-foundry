# Problem Context

`.005` 已经能把候选帖分流为 `auto_post`、`human_review`、`reject` 和 `defer`。用户确认当前阶段不做复杂审批 bot，只需要把需要人工处理的内容通知到自己的 Telegram 频道。

这意味着 `.006` 应该先解决 Telegram 最小连通性：

* 本地 secrets 能配置 bot token 和频道目标。
* 代码能调用官方 Telegram Bot API。
* 离线测试能覆盖请求构造、错误处理和脱敏。
* 在线 debug 入口必须由用户明确触发。
* 真实发送后由用户人工确认频道是否收到。

后续真正运营时，`human_review / telegram_human_gate` 可以先解释为“通知用户人工处理”，而不是完整审批闭环。
