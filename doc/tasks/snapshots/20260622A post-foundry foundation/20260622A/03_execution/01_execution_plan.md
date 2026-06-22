# 第一主任务执行计划

## 阶段 0：文档 Gate

先完成人工可审阅的 root task 与第一个子任务文档。当前阶段只写文档，不写代码、不装依赖、不访问外部 API。

文档 Gate 需要人工确认：

* 第一主任务是否确认为三星 root task。
* 第一子任务是否确认为 `20260622A.001 api connectivity harness`。
* API 离线测试和在线 debug 是否放在同一个子任务中。
* 技术栈是否冻结为 TypeScript、Bun、克制使用的 SvelteKit、SQLite、Drizzle、Zod、Vitest 和 `just`。
* 是否接受“不做反检测浏览器、不做网页登录自动化、不做无人自动隐藏回复”的项目边界。
* 是否接受在线、真实外部服务和可能计费的验证只能由用户明确要求后手动运行，不能进入默认测试、CI 或 agent 自主 Close Gate。

## 阶段 1：`20260622A.001 api connectivity harness`

落地 API 连通性验证框架。这个子任务先建立项目最小脚手架、`justfile`、API provider contract、离线 fixture 测试和在线 debug 脚本。

核心交付：

* `just test-api-offline`：正式离线 API contract 测试入口。
* `just debug-api-online`：用户明确要求时才可运行的手动在线 API smoke 入口。
* 公开 X 数据 provider port、TwitterAPI.io 只读 adapter 的请求构造、响应解析、错误语义和 fixture。
* X 官方 API 发帖 client 的请求构造、dry-run、真实发帖保护开关和错误语义。
* 缺少本地 secrets 文件、账号缺少 token、未授权、rate limit、schema drift、网络失败的稳定错误报告。

阶段停止线：

* 离线测试能证明 API client contract，不访问网络。
* 在线 debug 能在用户明确要求且有密钥时手动验证真实服务，在无密钥时清晰失败。
* 在线 debug、OAuth/token 命令、真实发帖和第三方读回不得被自动测试、CI、定时回归、agent 自主 Close Gate 或 "run all" 触发。
* 默认命令不会发真实 X 帖子。
* 真实发帖必须显式设置硬开关和测试账号。

## 阶段 2：`20260622A.002 account registry and config isolation`

建立多账号注册表和配置隔离。这个子任务只处理账号身份、配置和运行边界，不做选题、草稿或发布队列。

核心交付：

* `account_uuid` 内部不可变主键。
* `account_key` 可配置、可重命名、唯一。
* `x_identity` 与 OAuth token 状态单独管理。
* 全局配置、账号配置、运行状态分层。
* 配置 schema 校验和配置版本快照。
* 每账号预算字段、主题、语言、风格、发帖节奏和数据源隔离。

阶段停止线：

* 新增账号只需要配置和授权，不需要改代码。
* 账号重命名不会改变历史数据归属。
* 任意账号相关查询都必须显式带 `account_uuid` 或通过可信 resolver 从 `account_key` 解析。
* 本阶段只冻结预算字段和隔离规则，不冻结热点扫描的真实查询频率、分页规模或 provider 调用预算。

## 阶段 3：`20260622A.003 runtime skeleton and storage baseline`

建立本地运行骨架和 SQLite/Drizzle 存储基线。这个子任务让系统能以本地服务形态启动，并能记录任务状态、API 调用审计和基础运行日志。

核心交付：

* SQLite 文件路径配置。
* Drizzle schema 和 migration 入口。
* repo 层基础读写。
* job 状态表和审计表。
* 本地启动入口和健康检查。
* SvelteKit 薄页面骨架，只展示系统状态和账号列表，不承载业务逻辑。

阶段停止线：

* 本地启动不依赖外部数据库服务。
* 业务代码不直接散落 SQL。
* SvelteKit route 只做薄 glue。
* 数据库文件可放进 Podman volume。

## 后续 root task 候选

第一主任务不承接完整 MVP。后续能力按独立 root task 推进：

```text
20260622B topic source and trend ranking
    公开数据源、TwitterAPI.io 查询、账号级关键词池、热点评分和真实查询预算。

20260622C draft generation and style control
    LLM 草稿生成、账号级风格、禁区检查、质量评分。

20260622D publishing queue
    X 官方 API 发帖队列、节奏控制、失败重试、真实发布审计。

20260622E metrics and learning loop
    帖子表现记录、主题复盘、账号级经验沉淀。

20260622F comment review assistant
    评论拉取、AI 分类、人工确认隐藏队列。
```

这些后续 task 不能提前混入第一主任务，否则第一主任务会失去停止线。

## 验证计划

实现阶段的默认验证顺序：

```text
just check
just test
just test-api-offline
```

在线验证只作为人工辅助，且只能在用户当前明确要求时运行；可能计费的第三方 API 请求、X OAuth token endpoint 调用、真实发帖和第三方读回不得自动运行：

```text
just debug-api-online
```

如果在线验证因用户未明确要求、没有密钥、网络受限、可能产生费用或用户未授权真实发帖而未运行，`04_review` 和最终报告必须写清原因、影响和残余风险。
