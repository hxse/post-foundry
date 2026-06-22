# Runtime Storage Baseline Spec

## 交付物

`.003` 必须交付：

* `src/lib/storage/schema.ts`：Drizzle `sqlite-core` table schema。
* `src/lib/storage/migrations.ts`：runtime migration SQL。
* `src/lib/storage/sqlite.ts`：SQLite open/apply migration/list tables。
* `src/lib/storage/repositories.ts`：repo 层基础读写。
* `src/lib/runtime/health.ts`：runtime health snapshot。
* `src/cli/runtime-health.ts` 和 `just runtime-health`：本地健康检查。
* `src/routes/+page.server.ts` 和 `src/routes/+page.svelte`：薄状态页面。
* `tests/storage-offline.test.ts` 和 `just test-storage-offline`：离线存储测试。

## SQLite 配置

默认数据库路径：

```text
data/post-foundry.sqlite
```

可通过环境变量覆盖：

```text
POST_FOUNDRY_DB_FILE=/path/to/post-foundry.sqlite
```

`data/` 必须被 Git / jj 忽略。本阶段不把 SQLite 文件提交到仓库。

## Schema

本阶段冻结以下表：

```text
schema_migrations
accounts
account_key_history
x_identities
config_snapshots
jobs
api_call_audit
```

账号相关表必须使用 `account_uuid` 作为归属真值。`account_key` 只作为当前别名或快照标签，不作为业务外键。

## Repo 约束

repo 层必须提供：

* upsert account。
* upsert X identity。
* save config snapshot。
* record account key rename audit。
* create job。
* record API call audit。
* list accounts。
* list jobs by explicit `account_uuid`。
* list API audit rows by explicit `account_uuid`。

账号相关查询不能隐式使用 `account_key` 拼 SQL。需要从 key 进入账号时，必须先经过 `.002` 的可信 resolver。

## Runtime Health

`just runtime-health` 输出 JSON：

```json
{
  "status": "ok",
  "database": {
    "applied_migrations": ["0001_runtime_storage_baseline"],
    "tables": []
  },
  "counts": {
    "accounts": 0,
    "jobs": 0,
    "api_call_audit": 0,
    "config_snapshots": 0
  }
}
```

该命令只访问本地 SQLite，不访问 secrets、TwitterAPI.io、X OAuth endpoint 或 X official API。

## SvelteKit 页面

本阶段页面只能显示：

* runtime health。
* migration/table count。
* account/job/API audit/config snapshot count。
* 账号列表。

route 只能作为薄 glue；不得把 SQL、migration 或业务规则写进 route。

## 验证

默认离线验证：

```text
just check
just test-storage-offline
just test
just runtime-health
```

`just runtime-health` 会创建本地 ignored SQLite 文件。它不访问网络。`.003` 不运行 `just debug-api-online`、`just x-token`、`just x-token-auth`、真实发帖或第三方在线读回。
