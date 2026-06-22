# 20260622A.003 Runtime Skeleton And Storage Baseline

## 目标

建立 PostFoundry 第一阶段的本地运行骨架和 SQLite/Drizzle 存储基线。这个子任务把 `.001` 的 API contract 和 `.002` 的账号 registry/config contract 接到可持久化的本地 runtime 中，但不实现选题、草稿、正式发布队列、复盘算法或完整 UI。

## 星级

三星任务。原因是本任务确定项目运行态的基础形状：SQLite 文件路径、migration、repo 层、job 状态、API audit、配置快照和本地健康检查。如果这层不清楚，后续 topic/draft/publishing/metrics task 会把状态散落在脚本、JSON 和临时文件里，难以审计也难以迁移。

## 范围

包含：

* SQLite 文件路径配置。
* Drizzle `sqlite-core` schema。
* runtime migration 入口。
* repo 层基础读写。
* accounts、account_key_history、x_identities、config_snapshots、jobs、api_call_audit 表。
* runtime health snapshot 和 CLI。
* 薄 SvelteKit 页面，只展示系统状态和账号列表。
* 离线 SQLite 测试，不访问网络。

不包含：

* 正式业务算法。
* 发布队列调度器。
* 外部 API 调用。
* 真实发帖。
* token 加密存储。
* 完整管理 UI。
