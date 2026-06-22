# Account Registry And Config Isolation Spec

## 交付物

`.002` 必须交付：

* `config/accounts.example.json`：可提交的非敏感账号配置示例。
* `src/lib/accounts/registry.ts`：账号配置 schema、registry builder、resolver、snapshot 和 rename audit。
* `tests/accounts-offline.test.ts`：离线 contract 测试。
* `just test-accounts-offline`：只运行账号配置离线测试。

## 配置边界

账号配置分三层：

```text
global config      默认语言、时区、安全边界等非敏感全局规则
account config     account_uuid、account_key、主题、风格、预算、发帖节奏、数据源
runtime state      X 身份、OAuth token 状态、队列、历史发帖、指标、复盘
```

本阶段只把 X 身份和 OAuth token 状态做成非敏感 runtime state 记录。token 本体不允许进入普通配置、task 文档或测试 fixture。未来如果基于示例复制本地真实账号配置，文件必须使用 `config/*.local.json` 命名并被 Git ignore 保护。

## Account Registry

每个账号必须有：

```text
account_uuid       内部不可变 UUID，历史归属真值
account_key        人类可读别名，唯一、可重命名
display_name       展示名
platform           当前只允许 x
language           账号语言
enabled            是否启用
config_version     账号配置版本
topics             include/exclude 主题边界
posting            cadence、daily_min/max、cooldown、approval、real_posting_enabled
budget             x data、LLM、公开 X 查询请求预算字段
data_sources       公开 X 数据源 provider、关键词和请求预算
style              语气、规则、禁用短语
```

所有账号相关业务入口必须显式传入 `account_uuid`，或通过可信 resolver 从 `account_key` 解析到 `account_uuid`。如果调用方同时传入 `account_uuid` 和 `account_key`，resolver 必须校验两者指向同一账号；不一致时返回 `invalid_request`。

## X Identity

X 身份记录必须按 `account_uuid` 关联：

```text
account_uuid
x_user_id
x_handle
oauth_token_status = missing | authorized | expired | revoked | unknown
last_verified_at
```

这里不保存 access token、refresh token、client secret、cookie 或密码。账号授权信息仍在 ignored secrets 文件中维护，后续存储任务再决定是否进入数据库加密存储。

## 配置版本快照

任何后续草稿、排程、发帖或复盘记录都应保存当时的账号配置快照：

```text
account_uuid
account_key
config_version
config_hash
captured_at
payload
```

`config_hash` 必须稳定：同一配置得到同一 hash；预算、主题、风格、数据源或 key 变化后 hash 应变化。快照以 `account_uuid` 为归属真值，`account_key` 只作为当时的人类可读标签。`captured_at` 必须校验为 ISO datetime，不能把任意字符串写入快照。

## 重命名

账号重命名只能修改 `account_key`，不能修改 `account_uuid`。重命名必须：

* 校验新 key 格式。
* 拒绝与其他账号冲突。
* 将目标账号 `config_version` 加一。
* 生成审计记录：旧 key、新 key、account_uuid、actor、at。
* 校验 `actor` 非空，校验 `at` 为 ISO datetime。
* 保持 X identity 和后续业务归属仍然绑定同一个 `account_uuid`。

## 验证

默认验证只允许离线命令：

```text
just check
just test
just test-accounts-offline
```

本阶段不得运行 `just debug-api-online`、`just x-token`、`just x-token-auth`、TwitterAPI.io、X OAuth endpoint、X official API、真实发帖或第三方在线读回。
