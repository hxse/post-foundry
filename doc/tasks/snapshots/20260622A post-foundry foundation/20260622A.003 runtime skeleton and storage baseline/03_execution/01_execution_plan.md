# Execution Plan

## 阶段 1：Storage Schema

新增 Drizzle `sqlite-core` schema 和 SQL migration。schema 先覆盖账号投影、identity、配置快照、job 状态和 API audit，不实现业务领域全量表。

## 阶段 2：SQLite Runtime

实现 SQLite 打开、目录创建、migration 幂等应用、表列表和 migration 列表。默认路径为 `data/post-foundry.sqlite`，支持 `POST_FOUNDRY_DB_FILE` 覆盖。

## 阶段 3：Repo Layer

实现最小 repo 层：

* account / identity upsert。
* config snapshot 保存。
* account key rename audit。
* job 创建和按 `account_uuid` 查询。
* API audit 创建和按 `account_uuid` 查询。

## 阶段 4：Runtime Health / Thin UI

实现 `just runtime-health` 和 SvelteKit 首页。页面只展示 health 和账号列表，不承载业务逻辑。

## 阶段 5：Offline Gate

新增 `tests/storage-offline.test.ts`，覆盖 migration 幂等、账号 registry 持久化、rename audit、job/audit 按 `account_uuid` 隔离和 runtime health。

验证：

```text
just check
nix shell nixpkgs#nodejs --command just test-storage-offline
nix shell nixpkgs#nodejs --command just test
nix shell nixpkgs#nodejs --command just runtime-health
git diff --check
```

不运行任何在线 API 或真实发帖命令。
