# Telegram Notification Connectivity Spec

## Provider Choice

本 task 不引入 Telegram bot 框架，直接使用官方 Telegram Bot API：

* `getMe`
* `sendMessage`

理由：当前只需要连通性和通知发送，直接 HTTP 更容易审计、依赖更少、离线测试更直接。

## Secrets

Telegram 配置位于 ignored 的 `secrets/accounts.local.json`：

```json
{
  "version": 1,
  "global_providers": {
    "telegram": {
      "bot_token": "replace-with-telegram-bot-token",
      "notification_channel_chat_id": "@replace_with_channel_username_or_-100_channel_id"
    }
  },
  "accounts": {}
}
```

字段：

* `bot_token`: BotFather 给出的 bot token。
* `notification_channel_chat_id`: 公开频道可用 `@channelusername`；私有频道通常是 `-100...` 数字 id。

也支持环境变量覆盖：

* `TELEGRAM_BOT_TOKEN`
* `TELEGRAM_NOTIFICATION_CHANNEL_CHAT_ID`

## Channel Setup

用户需要在自己的 Telegram 客户端里：

* 创建或选择一个频道。
* 把 bot 加入频道。
* 给 bot 发消息权限；如果不确定，设为频道管理员最省事。

不需要提供 Telegram 账号密码、手机号、用户 session、cookie 或浏览器登录。

## CLI

新增：

```text
just debug-tg-online --send --message "把复杂的事情记录下来，才有机会让判断慢慢变好。"
```

安全规则：

* 没有 `--send` 时只做 dry-run，不访问 Telegram。
* `--send` 必须显式提供。
* 文案不能为空，且不能像 smoke/debug/task 测试文案。
* 输出只打印 bot token 指纹、发送结果和 message id，不打印完整 token。
* 在线发送后由用户人工确认频道是否收到。

## Acceptance

离线测试必须证明：

* secrets schema 接受 Telegram 配置。
* 环境变量可以覆盖 Telegram 本地配置。
* `getMe` 和 `sendMessage` 请求形状正确。
* Telegram API 错误能映射为 `ApiError`。
* 明显 smoke/debug/task 文案会被拦截。
* `bot_token` 风格 secret 会被脱敏。

本 task 不执行真实在线发送；真实发送等用户填好配置后手动运行 debug 命令。
