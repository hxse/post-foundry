# 20260622A.002 Account Registry And Config Isolation

## 目标

建立 PostFoundry 第一阶段的账号注册表和非敏感账号配置隔离基线。这个子任务只处理账号身份、配置 schema、可信 resolver、配置版本快照、账号 key 重命名审计和每账号预算/主题/节奏/数据源隔离，不实现选题、草稿、发布队列、指标复盘或 UI。

## 星级

三星任务。原因是账号隔离是后续自动化运营闭环的基础：一旦 `account_key` 被当作历史归属真值、预算和主题配置串号、或 token 状态混进普通配置，后续发帖、复盘和学习都会出现难排查的错误。

## 范围

包含：

* 非敏感账号配置示例。
* `account_uuid` 内部不可变主键。
* `account_key` 可配置、唯一、可重命名。
* X 身份和 OAuth token 状态的非敏感记录。
* 全局配置、账号配置、运行状态的边界。
* 账号配置 Zod schema 校验。
* 可信 resolver：从 `account_key` 解析到 `account_uuid`，并拒绝 key/uuid 不一致。
* 配置版本快照和稳定 hash。
* 账号重命名审计记录。
* 离线测试入口，不访问网络和真实 secrets。

不包含：

* SQLite/Drizzle 表和 migration。
* OAuth token 加密存储。
* 正式选题、草稿、发布队列、复盘算法。
* UI。
* 任何在线 API 调用、X 页面访问或真实发帖。
