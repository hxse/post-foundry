# 问题背景

PostFoundry 后续要让 AI 辅助运营少量自有 X 账号。即使现在只有一个账号，代码也不能把账号身份写死成一个 handle、一个 `account_key` 或一个 secrets 路径。后续热点筛选、草稿风格、排程、预算、指标和复盘都必须归属到正确账号，否则一个账号的策略和经验会污染另一个账号。

`account_uuid` 是内部不可变真值。历史草稿、发帖记录、预算消耗、API 调用日志、指标和复盘记忆都应绑定 `account_uuid`。`account_key` 只是给人和 CLI 使用的可读别名，可以重命名；重命名后历史数据归属不能变化。

本阶段仍不落数据库。原因是 `.003` 才负责 SQLite/Drizzle 存储基线。`.002` 先冻结模型和离线 contract：非敏感账号配置如何表达、schema 如何拒绝串号和敏感字段、业务层如何通过可信 resolver 从 key 进入 uuid、配置版本快照如何让未来草稿/排程/发帖记录能解释当时使用的规则。

敏感信息继续留在 ignored 的 `secrets/accounts.local.json`。普通配置不能包含 X access token、refresh token、client secret、cookie 或密码。X 身份记录只允许保存公开或非敏感标识，以及 token 状态枚举；token 本体仍由 secrets/OAuth 流程管理。

在线 API 调用不属于本阶段。账号配置测试只使用 fixture 和示例配置，不访问 TwitterAPI.io、X OAuth endpoint、X official API，也不打开 `x.com`。
